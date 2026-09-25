"""Nimble: fresh external observations — forecast/frost risk, pest alerts, variety notes (PDD §7).

Sources, each optional and each allowed to fail without stopping the loop:

* Forecast — Open-Meteo (free, no key) when ``GARDEN_LAT``/``GARDEN_LON`` are set.
  PDD §12: "Nimble has no gardening API → weather APIs + web search adapter".
* Pest alerts + variety notes — Nimble web search when ``NIMBLE_API_KEY`` and
  ``NIMBLE_API_URL`` are set. Searches are cached for ``NIMBLE_SEARCH_EVERY_S``.
* Demo mode (``PERENNIAL_DEMO=1``) — the scripted "cold snap Thursday" forecast
  for the live-rewrite moment.

Every observation is ``{ts, source: "nimble", kind, content: {text, provider, ...}, loop}``.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from plan import WEEKDAY, iso, next_weekday

HttpGet = Callable[[str, dict[str, str], bytes | None], Any]


def _http(url: str, headers: dict[str, str], body: bytes | None = None, timeout: float = 15) -> Any:
    req = urllib.request.Request(url, data=body, headers={"user-agent": "perennial-loop/0.1", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _obs(now: datetime, kind: str, loop: int, text: str, provider: str, **extra: Any) -> dict:
    return {
        "ts": iso(now),
        "source": "nimble",
        "kind": kind,
        "content": {"text": text, "provider": provider, **extra},
        "loop": loop,
    }


def forecast(now: datetime, loop: int, http: HttpGet = _http) -> dict | None:
    lat, lon = os.environ.get("GARDEN_LAT"), os.environ.get("GARDEN_LON")
    if not (lat and lon):
        return None
    qs = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum",
        "forecast_days": 7,
        "timezone": "auto",
    })
    data = http(f"https://api.open-meteo.com/v1/forecast?{qs}", {}, None)
    daily = data["daily"]
    days = list(zip(daily["time"], daily["temperature_2m_min"], daily["temperature_2m_max"], daily["precipitation_sum"]))
    day, low, high, _ = min(days, key=lambda d: d[1])
    rain = round(sum(d[3] or 0 for d in days))
    wd = WEEKDAY[date.fromisoformat(day).weekday()]
    return _obs(now, "forecast", loop, f"7-day forecast: coldest {wd} {day} low {round(low)}°C, high {round(high)}°C; {rain} mm rain this week",
                "open-meteo", low=round(low), date=day, rain_mm=rain)


def conditions(now: datetime, loop: int, last_time: str | None, http: HttpGet = _http) -> dict | None:
    """Current conditions (Open-Meteo refreshes every 15 min). None if unchanged since ``last_time``."""
    lat, lon = os.environ.get("GARDEN_LAT"), os.environ.get("GARDEN_LON")
    if not (lat and lon):
        return None
    qs = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_temperature_0cm,soil_moisture_0_to_1cm",
        "timezone": "auto",
    })
    cur = http(f"https://api.open-meteo.com/v1/forecast?{qs}", {}, None)["current"]
    if cur["time"] == last_time:
        return None
    air, soil, moist = cur["temperature_2m"], cur["soil_temperature_0cm"], cur["soil_moisture_0_to_1cm"]
    text = (f"Now {air}°C air, {soil}°C soil, soil moisture {moist:.2f} m³/m³, humidity {cur['relative_humidity_2m']}%, "
            f"wind {round(cur['wind_speed_10m'])} km/h, {cur['precipitation']} mm rain")
    return _obs(now, "conditions", loop, text, "open-meteo", obs_time=cur["time"], air_c=air, soil_c=soil,
                soil_moisture=moist, humidity=cur["relative_humidity_2m"], wind_kmh=cur["wind_speed_10m"],
                rain_mm=cur["precipitation"])


def alerts(now: datetime, loop: int, seen: set[str], http: HttpGet = _http) -> list[dict]:
    """Active National Weather Service alerts for the garden's point (frost/freeze, storms). New ones only."""
    lat, lon = os.environ.get("GARDEN_LAT"), os.environ.get("GARDEN_LON")
    if not (lat and lon):
        return []
    data = http(f"https://api.weather.gov/alerts/active?point={lat},{lon}",
                {"user-agent": "perennial-loop/0.1 (home garden agent)", "accept": "application/geo+json"}, None)
    out = []
    for f in data.get("features", []):
        p = f.get("properties", {})
        if p.get("id") in seen:
            continue
        seen.add(p["id"])
        out.append(_obs(now, "alert", loop, f"{p.get('event')}: {p.get('headline')}", "nws", alert_id=p["id"],
                        event=p.get("event"), severity=p.get("severity"), expires=p.get("expires")))
    return out


def news(now: datetime, loop: int, plan: dict, seen: set[str], http: HttpGet = _http) -> list[dict]:
    """Nimble news search for pest/disease reports near the garden in the last day. New URLs only."""
    key, url = os.environ.get("NIMBLE_API_KEY"), os.environ.get("NIMBLE_API_URL")
    crops = sorted({b["crop"] for b in plan.get("beds", []) if b.get("crop")})
    if not (key and url and crops):
        return []
    region = os.environ.get("GARDEN_REGION", "")
    body = json.dumps({"query": f"{' OR '.join(crops[:4])} pest disease {region}", "max_results": 5,
                       "search_depth": "lite", "focus": "news", "time_range": "day"}).encode()
    data = http(url, {"authorization": f"Bearer {key}", "content-type": "application/json"}, body)
    out = []
    for r in data.get("results", []):
        link = r.get("url")
        if not link or link in seen:
            continue
        seen.add(link)
        out.append(_obs(now, "pest", loop, f"{r.get('title', '').strip()} — {(r.get('description') or '').strip()[:180]}",
                        "nimble", url=link))
    return out


def significant(o: dict) -> bool:
    """Should this observation wake the gardener right away? Routine conditions readings wait for the next think."""
    c = o.get("content", {})
    if o.get("kind") != "conditions":
        return True
    return (c.get("air_c", 99) <= 3 or c.get("soil_c", 99) <= 2 or c.get("rain_mm", 0) >= 5
            or c.get("wind_kmh", 0) >= 50 or not 0.08 <= c.get("soil_moisture", 0.25) <= 0.45)


def demo_forecast(now: datetime, loop: int) -> dict:
    thu = next_weekday(now.date(), 3)
    return _obs(now, "forecast", loop, f"7-day forecast: Thu {thu.isoformat()} low 2°C — cold snap", "demo", low=2, date=thu.isoformat())


def _snippets(payload: Any, limit: int = 3) -> list[str]:
    """Pulls title/snippet text out of whatever shape the search response has."""
    found: list[str] = []

    def walk(v: Any) -> None:
        if len(found) >= limit:
            return
        if isinstance(v, dict):
            title = v.get("title") or v.get("name")
            snippet = v.get("snippet") or v.get("description") or v.get("content")
            if isinstance(title, str) and isinstance(snippet, str):
                found.append(f"{title.strip()} — {snippet.strip()[:180]}")
                return
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(payload)
    return found


def nimble_search(query: str, http: HttpGet = _http) -> list[str]:
    """One Nimble web search (POST https://sdk.nimbleway.com/v2/search → {results: [{title, description, url}]})."""
    key, url = os.environ.get("NIMBLE_API_KEY"), os.environ.get("NIMBLE_API_URL")
    if not (key and url):
        return []
    body = json.dumps({"query": query, "max_results": 3, "search_depth": "lite", "time_range": "month"}).encode()
    return _snippets(http(url, {"authorization": f"Bearer {key}", "content-type": "application/json"}, body))


def collect(now: datetime, loop: int, plan: dict, recent: list[dict], http: HttpGet = _http) -> list[dict]:
    """All fresh external observations for this loop. ``recent`` = past observations (for caching)."""
    out: list[dict] = []

    def attempt(name: str, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except Exception as err:  # Nimble failure → loop continues on user logs alone
            print(f"[nimble] {name} failed: {err}", file=sys.stderr)
            return None

    if os.environ.get("PERENNIAL_DEMO", "1") != "0":
        out.append(demo_forecast(now, loop))
    else:
        fc = attempt("forecast", lambda: forecast(now, loop, http))
        if fc:
            out.append(fc)

    every = timedelta(seconds=int(os.environ.get("NIMBLE_SEARCH_EVERY_S", "3600")))
    last_search = max((o["ts"] for o in recent if o.get("content", {}).get("provider") == "nimble"), default="")
    due = not last_search or datetime.fromisoformat(last_search.replace("Z", "+00:00")) < now - every
    if due and os.environ.get("NIMBLE_API_KEY") and os.environ.get("NIMBLE_API_URL"):
        region = os.environ.get("GARDEN_REGION", "")
        crops = sorted({b["crop"] for b in plan.get("beds", []) if b.get("crop")})
        if crops:
            hits = attempt("pests", lambda: nimble_search(f"{' '.join(crops)} pest disease alert {region} this week", http)) or []
            out += [_obs(now, "pest", loop, h, "nimble") for h in hits[:2]]
        for crop in crops[:3]:
            hits = attempt("variety", lambda c=crop: nimble_search(f"growing {c} in autumn tips {region}", http)) or []
            out += [_obs(now, "variety", loop, h, "nimble", crop=crop) for h in hits[:1]]
    return out


def utcnow() -> datetime:
    return datetime.now(timezone.utc)

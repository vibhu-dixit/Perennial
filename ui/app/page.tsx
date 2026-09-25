import Garden from "@/components/Garden";
import { gardenState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Garden initial={await gardenState()} />;
}

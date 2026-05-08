import nextDynamic from "next/dynamic";

const Game = nextDynamic(() => import("./Game"), { ssr: false });

// Disable static prerendering - page is fully client-side
export const dynamic = "force-dynamic";

export default function Page() {
  return <Game />;
}

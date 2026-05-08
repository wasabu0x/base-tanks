"use client";

import nextDynamic from "next/dynamic";

const Game = nextDynamic(() => import("./Game"), { ssr: false });

export default function Page() {
  return <Game />;
}

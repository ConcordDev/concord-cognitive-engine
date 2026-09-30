import { createFileRoute } from "@tanstack/react-router";
import { GameRoot } from "@/components/concordia/GameRoot";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="h-full w-full">
      <GameRoot />
    </main>
  );
}

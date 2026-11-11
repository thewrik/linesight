import { useEffect, useState } from "react";
import { probeApi } from "./data";
import Landing from "./components/Landing";
import CaseView from "./components/CaseView";
import EvalView from "./components/EvalView";
import SourcesView from "./components/SourcesView";
import AboutView from "./components/AboutView";
import Journey from "./journey/Journey";

function useHash() {
  const [h, setH] = useState(window.location.hash || "#/");
  useEffect(() => {
    const f = () => { setH(window.location.hash || "#/"); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const [api, setApi] = useState<{ modes: string[]; live_model: string | null } | null | undefined>(undefined);
  useEffect(() => { probeApi().then(setApi); }, []);
  const route = hash.replace(/^#\//, "").split("/");
  const page = route[0] || "home";
  const nav = [["home", "#/", "Overview"], ["eval", "#/eval", "Evaluation"], ["sources", "#/sources", "Sources"], ["about", "#/about", "How it works"]];
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/"><span className="mark" aria-hidden />LineSight</a>
        <nav aria-label="Main">
          {nav.map(([k, href, label]) => <a key={k} href={href} aria-current={page === k ? "page" : undefined}>{label}</a>)}
        </nav>
        <span className="modepill" title="Where case data comes from">
          {api === undefined ? "…" : api ? `API · ${api.modes.includes("live") ? "live model available" : "no model key"}` : "static replay · no backend"}
        </span>
      </header>
      <main className={page === "home" ? "" : "wrap"}>
        {page === "home" && <Landing />}
        {page === "journey" && <Journey key={route[1]} scenarioId={route[1]} />}
        {page === "case" && api !== undefined && <CaseView key={route[1]} scenarioId={route[1]} api={api} initialStep={route[2] ? Number(route[2]) : undefined} />}
        {page === "eval" && <EvalView />}
        {page === "sources" && <SourcesView />}
        {page === "about" && <AboutView />}
      </main>
    </>
  );
}

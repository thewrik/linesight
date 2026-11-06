import { useEffect, useState } from "react";
import { dataUrl, fetchJson } from "../data";

export default function SourcesView() {
  const [s, setS] = useState<any[]>([]);
  useEffect(() => { fetchJson<any[]>(dataUrl("sources.json")).then(setS).catch(() => setS([])); }, []);
  return (
    <div className="stack">
      <div className="banner-sim">
        These public sources document individual failure mechanisms. They are not a record of this (fictional) plant, and no vendor relationship is implied.
        Public issue reports are observations, not proof of a root cause. Paraphrases only.
      </div>
      {s.map((x) => (
        <section className="panel" key={x.id} data-testid={`source-${x.id}`}>
          <h2><span className="mono">{x.id}</span> <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a></h2>
          <dl className="kv">
            <dt>Evidence type</dt><dd>{x.evidence_type.replaceAll("_", " ")}</dd>
            <dt>Retrieved</dt><dd>{x.retrieved}</dd>
            <dt>Paraphrase</dt><dd>{x.paraphrase}</dd>
            <dt>Applicability</dt><dd>{x.applicability}</dd>
            <dt>Documented outcome</dt><dd>{x.documented_outcome}</dd>
            <dt>Unresolved</dt><dd>{x.unresolved_questions}</dd>
            <dt>Used by</dt><dd className="mono small">{x.used_by.join(", ")}</dd>
            <dt>Fixture relation</dt><dd>{x.fixture_relation.replaceAll("_", " ")}</dd>
          </dl>
        </section>
      ))}
    </div>
  );
}

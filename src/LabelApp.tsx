import { useEffect, useMemo, useState } from "react";
import { AnnotationChart } from "./components/AnnotationChart";
import type { WeeklyBar } from "./domain/types";
import "./label.css";

type HumanLabel = "stage_1" | "stage_3" | "uncertain" | "skip";
interface Candidate {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  date: string;
  bars: WeeklyBar[];
}
interface CandidateFile { schemaVersion: number; generatedAt: string; protocol: string; candidates: Candidate[] }
interface SavedLabel { candidateId: string; label: HumanLabel; labeledAt: string }

const STORAGE_KEY = "stage13-human-labels-v1";
const labelNames: Record<HumanLabel, string> = {
  stage_1: "Stage 1 · 底部构筑",
  stage_3: "Stage 3 · 高位震荡",
  uncertain: "不确定",
  skip: "跳过",
};

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, SavedLabel>; }
  catch { return {}; }
}

export default function LabelApp() {
  const [data, setData] = useState<CandidateFile | null>(null);
  const [saved, setSaved] = useState<Record<string, SavedLabel>>(readSaved);
  const [index, setIndex] = useState(0);
  const candidates = data?.candidates ?? [];
  const current = candidates[index] ?? null;
  const completed = Object.keys(saved).filter((id) => candidates.some((item) => item.id === id)).length;

  useEffect(() => {
    fetch("./data/stage13-candidates.json").then((response) => response.json()).then(setData);
  }, []);

  const nextUnlabeled = useMemo(
    () => candidates.findIndex((candidate, candidateIndex) => candidateIndex > index && !saved[candidate.id]),
    [candidates, index, saved],
  );

  function save(label: HumanLabel) {
    if (!current) return;
    const updated = { ...saved, [current.id]: { candidateId: current.id, label, labeledAt: new Date().toISOString() } };
    setSaved(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setIndex(nextUnlabeled >= 0 ? nextUnlabeled : Math.min(index + 1, candidates.length - 1));
  }

  function exportLabels() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceGeneratedAt: data?.generatedAt,
      labels: Object.values(saved),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stage13-labels-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!data || !current) return <main className="label-page"><p>正在读取标注候选样本…</p></main>;

  return (
    <main className="label-page">
      <header className="label-header">
        <div><strong>Stage 1 / Stage 3 人工标注</strong><p>只根据截至标注周的K线判断，不显示模型答案。</p></div>
        <div className="label-progress"><span>{completed}/{candidates.length}</span><button onClick={exportLabels}>导出标注 JSON</button></div>
      </header>
      <section className="label-instructions">
        <span><b>Stage 1</b>：此前经历下跌，处于相对低位，30周均线由下降转平。</span>
        <span><b>Stage 3</b>：此前经历上涨，处于相对高位，30周均线由上升转平。</span>
      </section>
      <section className="candidate-heading">
        <div><p>{current.symbol} · {current.exchange}</p><h1>{current.name}</h1></div>
        <div><span>判断时点</span><strong>{current.date}</strong></div>
      </section>
      <section className="annotation-panel">
        <AnnotationChart bars={current.bars} />
        <div className="decision-row">
          {(Object.keys(labelNames) as HumanLabel[]).map((label) => (
            <button key={label} className={label} onClick={() => save(label)}>{labelNames[label]}</button>
          ))}
        </div>
      </section>
      <nav className="candidate-nav">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>上一条</button>
        <span>{index + 1} / {candidates.length}{saved[current.id] ? ` · 已标注：${labelNames[saved[current.id].label]}` : ""}</span>
        <button disabled={index === candidates.length - 1} onClick={() => setIndex(index + 1)}>下一条</button>
      </nav>
    </main>
  );
}

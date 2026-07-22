import { useEffect, useMemo, useState } from "react";
import { AnnotationChart } from "./components/AnnotationChart";
import type { WeeklyBar } from "./domain/types";
import "./label.css";

type Consolidation = "yes" | "no" | "uncertain";
type PriorTrend = "up" | "down" | "mixed";
type Confidence = "high" | "medium" | "low";
interface Candidate { id: string; symbol: string; name: string; exchange: string; date: string; bars: WeeklyBar[] }
interface CandidateFile { generatedAt: string; candidates: Candidate[] }
interface StructuredLabel {
  candidateId: string;
  consolidation: Consolidation;
  priorTrend: PriorTrend;
  confidence: Confidence;
  derivedLabel: "stage_1" | "stage_3" | "uncertain";
  labeledAt: string;
}

interface LabelV2AppProps {
  candidateUrl?: string;
  storageKey?: string;
  title?: string;
  exportPrefix?: string;
}
const choices = {
  consolidation: [["yes", "已形成横盘"], ["no", "尚未横盘"], ["uncertain", "不确定"]] as const,
  priorTrend: [["up", "明确上涨"], ["down", "明确下跌"], ["mixed", "混合/不清楚"]] as const,
  confidence: [["high", "高"], ["medium", "中"], ["low", "低"]] as const,
};

function readSaved(storageKey: string) {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, StructuredLabel>; }
  catch { return {}; }
}

export default function LabelV2App({
  candidateUrl = "./data/stage13-validation-candidates.json",
  storageKey = "stage13-structured-validation-v2",
  title = "Stage 1 / Stage 3 · 独立结构化验证",
  exportPrefix = "stage13-structured-validation",
}: LabelV2AppProps) {
  const [data, setData] = useState<CandidateFile | null>(null);
  const [saved, setSaved] = useState<Record<string, StructuredLabel>>(() => readSaved(storageKey));
  const [index, setIndex] = useState(0);
  const [consolidation, setConsolidation] = useState<Consolidation | null>(null);
  const [priorTrend, setPriorTrend] = useState<PriorTrend | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const candidates = data?.candidates ?? [];
  const current = candidates[index] ?? null;
  const completed = Object.keys(saved).filter((id) => candidates.some((item) => item.id === id)).length;

  useEffect(() => {
    fetch(candidateUrl).then((response) => response.json()).then(setData);
  }, [candidateUrl]);
  useEffect(() => {
    if (!data) return;
    const firstUnlabeled = data.candidates.findIndex((candidate) => !saved[candidate.id]);
    if (firstUnlabeled >= 0) setIndex(firstUnlabeled);
  }, [data]);
  useEffect(() => {
    if (!current) return;
    const existing = saved[current.id];
    setConsolidation(existing?.consolidation ?? null);
    setPriorTrend(existing?.priorTrend ?? null);
    setConfidence(existing?.confidence ?? null);
  }, [current, saved]);

  const nextUnlabeled = useMemo(
    () => candidates.findIndex((candidate, candidateIndex) => candidateIndex > index && !saved[candidate.id]),
    [candidates, index, saved],
  );
  const canSave = consolidation !== null && priorTrend !== null && confidence !== null;

  function save() {
    if (!current || !consolidation || !priorTrend || !confidence) return;
    const derivedLabel: StructuredLabel["derivedLabel"] = consolidation === "yes"
      ? priorTrend === "down" ? "stage_1" : priorTrend === "up" ? "stage_3" : "uncertain"
      : "uncertain";
    const updated = {
      ...saved,
      [current.id]: { candidateId: current.id, consolidation, priorTrend, confidence, derivedLabel, labeledAt: new Date().toISOString() },
    };
    setSaved(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setIndex(nextUnlabeled >= 0 ? nextUnlabeled : Math.min(index + 1, candidates.length - 1));
  }

  function exportLabels() {
    const payload = { schemaVersion: 2, exportedAt: new Date().toISOString(), sourceGeneratedAt: data?.generatedAt, labels: Object.values(saved) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportPrefix}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!data || !current) return <main className="label-page"><p>正在读取独立验证样本…</p></main>;
  const question = <T extends string>(title: string, values: readonly (readonly [T, string])[], selected: T | null, setter: (value: T) => void) => (
    <section className="question-card"><strong>{title}</strong><div className="choice-row">{values.map(([value, text]) => (
      <button key={value} className={selected === value ? "selected" : ""} onClick={() => setter(value)}>{text}</button>
    ))}</div></section>
  );

  return <main className="label-page structured-label-page">
    <header className="label-header">
      <div><strong>{title}</strong><p>不直接判断Stage，分开记录横盘、前置趋势和信心。</p></div>
      <div className="label-progress"><span>{completed}/{candidates.length}</span><button disabled={completed < candidates.length} onClick={exportLabels}>{completed < candidates.length ? `还差${candidates.length - completed}条` : "导出验证 JSON"}</button></div>
    </header>
    <section className="candidate-heading">
      <div><p>{current.symbol} · {current.exchange}</p><h1>{current.name}</h1></div>
      <div><span>判断时点</span><strong>{current.date}</strong></div>
    </section>
    <section className="annotation-panel">
      <AnnotationChart bars={current.bars} height={330} />
      <div className="structured-questions">
        {question("① 当前是否已形成横盘结构？", choices.consolidation, consolidation, setConsolidation)}
        {question("② 横盘之前的主要趋势？", choices.priorTrend, priorTrend, setPriorTrend)}
        {question("③ 对这次判断的信心？", choices.confidence, confidence, setConfidence)}
      </div>
      <button className="save-structured" disabled={!canSave} onClick={save}>保存并进入下一条</button>
    </section>
    <nav className="candidate-nav">
      <button disabled={index === 0} onClick={() => setIndex(index - 1)}>上一条</button>
      <span>{index + 1} / {candidates.length}</span>
      <button disabled={index === candidates.length - 1} onClick={() => setIndex(index + 1)}>下一条</button>
    </nav>
  </main>;
}

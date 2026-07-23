import type { CoreStage } from "../domain/types";
import { stageMeta } from "../lib/stageMeta";

const guides: Array<{
  stage: CoreStage;
  points: string;
  average: string;
  notes: string[];
}> = [
  {
    stage: 1,
    points: "8,27 27,34 45,29 63,38 81,33 99,41 117,35 136,43 154,39 172,44",
    average: "8,31 50,33 92,36 134,39 172,42",
    notes: ["下跌趋势逐步结束", "30周均线趋于走平", "价格在低位区间震荡", "等待突破确认"],
  },
  {
    stage: 2,
    points: "8,49 27,35 45,40 63,25 81,31 99,18 117,25 136,12 154,19 172,6",
    average: "8,47 50,37 92,28 134,18 172,10",
    notes: ["价格站上30周均线", "30周均线持续向上", "高点与低点不断抬高", "趋势最强，重点持有"],
  },
  {
    stage: 3,
    points: "8,34 27,22 45,35 63,17 81,38 99,20 117,35 136,16 154,43 172,35",
    average: "8,33 50,31 92,29 134,28 172,27",
    notes: ["30周均线逐渐走平", "价格在高位宽幅震荡", "假突破和波动增多", "注意风险，逐步减仓"],
  },
  {
    stage: 4,
    points: "8,12 27,27 45,22 63,38 81,31 99,46 117,39 136,51 154,46 172,57",
    average: "8,16 50,25 92,35 134,44 172,52",
    notes: ["价格跌破30周均线", "30周均线转为向下", "高点与低点不断降低", "控制回撤，等待下一轮"],
  },
];

export function StageGuide() {
  return (
    <section className="panel stage-guide">
      <div className="stage-guide-heading">
        <div><span>WEINSTEIN 4 STAGES</span><h3>四阶段趋势周期</h3></div>
        <p>用周线与30周均线识别长期趋势位置</p>
      </div>

      <div className="stage-guide-grid">
        {guides.map(({ stage, points, average, notes }) => {
          const meta = stageMeta[`stage_${stage}`];
          return (
            <article
              key={stage}
              className={`stage-guide-card stage-guide-${stage}`}
              style={{ "--guide-color": meta.color } as React.CSSProperties}
            >
              <header><strong>Stage {stage}</strong><span>{meta.title}</span></header>
              <svg viewBox="0 0 180 64" role="img" aria-label={`Stage ${stage} ${meta.title}示意图`}>
                <line x1="6" y1="54" x2="174" y2="54" className="guide-baseline" />
                <polyline points={average} className="guide-average" />
                <polyline points={points} className="guide-price" />
              </svg>
              <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </article>
          );
        })}
      </div>

      <div className="cycle-flow" aria-label="四阶段完整生命周期">
        <span className="cycle-stage-4">Stage 4 <small>下降</small></span><i>→</i>
        <span className="cycle-stage-1">Stage 1 <small>筑底</small></span><i>→</i>
        <span className="cycle-stage-2">Stage 2 <small>上涨</small></span><i>→</i>
        <span className="cycle-stage-3">Stage 3 <small>筑顶</small></span><i>→</i>
        <span className="cycle-stage-4">Stage 4 <small>下降</small></span><i>→</i>
        <span className="cycle-stage-1">Stage 1 <small>新一轮筑底</small></span>
      </div>
    </section>
  );
}

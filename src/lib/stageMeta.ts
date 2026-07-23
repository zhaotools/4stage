import type { StageState } from "../domain/types";

export const stageMeta: Record<
  StageState,
  { short: string; title: string; description: string; color: string }
> = {
  stage_1: { short: "S1", title: "底部构筑", description: "下跌趋缓，价格进入新的平衡区间", color: "#2f9563" },
  stage_1_to_2: { short: "S1→2", title: "突破观察", description: "底部结构正在尝试向上突破", color: "#2d9a91" },
  stage_2: { short: "S2", title: "趋势上升", description: "价格运行在上升的长期均线上方", color: "#3378d4" },
  stage_2_to_3: { short: "S2→3", title: "趋势减速", description: "上升结构仍在，但趋势动能正在下降", color: "#a9a12a" },
  stage_3: { short: "S3", title: "高位震荡", description: "上升趋势失速，价格进入高位平衡", color: "#e08a28" },
  stage_3_to_4: { short: "S3→4", title: "破位观察", description: "高位结构受到破坏，等待周线确认", color: "#dd6245" },
  stage_4: { short: "S4", title: "趋势下降", description: "价格运行在下降的长期均线下方", color: "#d5484f" },
  stage_4_to_1: { short: "S4→1", title: "下跌趋缓", description: "下降斜率收敛，正在寻找新的平衡", color: "#756ba8" },
  stage_4_to_2: { short: "S4→2", title: "强势修复", description: "价格快速站回长期均线上方，等待上升趋势确认", color: "#278c78" },
  unclear: { short: "—", title: "阶段不明确", description: "多个阶段得分接近，暂不强制分类", color: "#718096" },
  insufficient_data: { short: "—", title: "历史数据不足", description: "至少需要52根完整周线", color: "#8b93a1" },
};

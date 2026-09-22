// UI 层共享：名称查找、风险徽标
import type { AppState, RiskLevel } from "../domain/types";

export function staffName(state: AppState, id: string | null | undefined): string {
  if (!id) return "未指派";
  return state.staff.find((s) => s.id === id)?.name ?? id;
}

export function roomName(state: AppState, id: string): string {
  return state.rooms.find((r) => r.id === id)?.name ?? id;
}

export const riskClass: Record<RiskLevel, string> = {
  稳定: "risk-stable",
  关注: "risk-watch",
  中风险: "risk-mid",
  高风险: "risk-high",
};

export const statusLabel: Record<string, string> = {
  draft: "草稿",
  confirmed: "已确认",
  frozen: "已冻结",
  completed: "已完成",
  pending: "待确认",
  rejected: "已驳回",
};

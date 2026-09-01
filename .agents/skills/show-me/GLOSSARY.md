---
title: Show Me Glossary
scope: show-me
version: "1.0.0"
last_updated: "2026-08-28"
status: stable
---

# Show Me Glossary

> Status: terminology authority
> Scope: `show-me` skill domain vocabulary
> Version: 1.0.0
> Last Updated: 2026-08-28
> Applies to: In-conversation structural visualizations, diagram selection, evidence grounding, and focused diff presentation

| Term | 中文 | Meaning | 中文解释 | _Avoid_ / ≠ |
| :--- | :--- | :--- | :--- | :--- |
| `VisualShape` | 视觉形态 | The smallest structural format chosen to expose a relationship (`Mermaid`, `CallTree`, `ShallowTree`, `Pseudocode`, `FocusedDiff`). | 为使核心结构与关联一目了然所选取的最小结构化视觉形式（流程图、调用树、目录树、伪代码、聚焦差异）。 | ≠ `FullGallery` (全景图库) |
| `EvidenceGrounding` | 证据实锚 | Anchoring node labels, function names, paths, and arrows in real codebase symbols and live runtime values. | 图表中所有的节点、函数名、路径与连线必须严格对应真实存在的代码符号与数据，杜绝抽象空谈。 | ≠ `AbstractPlaceholder` (抽象占位符) |
| `HypotheticalMarker` | 假想标识 | Explicit visual notation marking a proposed, planned, or unverified branch to distinguish it from existing reality. | 在图表中对尚未实现、拟议中或推测性的组件与分支添加的显式区分标记。 | ≠ `VerifiedReality` (已验证实况) |
| `FocusedDiff` | 聚焦差异 | A minimal before/after structural comparison highlighting only the transformed elements without full-file context. | 仅突出新旧模型/接口关键转换差异的微型对比片段，省略无关上下文行。 | ≠ `FullPatch` (完整代码补丁) |
| `PreambleFreeExplanation` | 无铺垫解释 | Concise accompanying prose that explains structural significance without narrating what is already visible in the diagram. | 直接说明结构演变意义与核心影响的精炼文字，不复述图表中一目了然的连线细节，绝无冗余铺垫。 | ≠ `NarrativeWalkthrough` (逐字图说) |

## Boundary Rules

1. **Smallest Useful Shape**: Prefer a single focused visual over a multi-diagram gallery; descend into code lines only as supporting evidence.
2. **Real vs Hypothetical**: Every node in a visual must either map to an existing path/symbol or carry an explicit `HypotheticalMarker`.

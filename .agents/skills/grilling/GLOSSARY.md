---
title: Grilling Glossary
scope: grilling
version: "1.0.0"
last_updated: "2026-08-28"
status: stable
---

# Grilling Glossary

> Status: terminology authority
> Scope: `grilling` skill domain vocabulary
> Version: 1.0.0
> Last Updated: 2026-08-28
> Applies to: Pre-implementation decision interviews, frontier batching, and design-locking protocols

| Term | 中文 | Meaning | 中文解释 | _Avoid_ / ≠ |
| :--- | :--- | :--- | :--- | :--- |
| `GrillLoop` | 决策盘问闭环 | A structured, non-implementing interview loop conducted before coding to stress-test plans and clarify ambiguity. | 编码前专门用于压力测试设计方案、澄清歧义并锁定决策的结构化访谈闭环（绝不在此阶段写代码）。 | ≠ `Implementation` (代码实现) |
| `DesignFrontier` | 决策前沿 | The complete set of open decisions whose prerequisite choices and codebase facts are already settled. | 前置依赖已明确、当前立即可独立向用户提问的所有开放决策点全集。 | ≠ `Backlog` (待办任务池) |
| `FrontierBatch` | 前沿批次轮 | A single numbered interview round presenting the entire current frontier simultaneously with recommended options. | 将当前前沿上的全部独立问题集中在单轮对话中编号呈现的提问批次。 | ≠ `SerialInterrogation` (单题串行逼问) |
| `RecommendedAnswer` | 推荐方案 | The concrete, evidence-backed choice supplied with each question, enabling the user to reply simply with `your rec`. | 随每个问题一并给出的有根据的推荐选项，支持用户直接回复“按你的推荐”。 | ≠ `OpenEndedQuestion` (无选项开放式发问) |
| `Direction` | 初步方向 | A preliminary or informal user reply that signals intent but has not yet been frozen into a binding contract. | 用户的初步倾向表达，仅作为探索方向，尚未正式确立为不可变约束。 | ≠ `DesignLock` (设计锁) |
| `ProposedLock` | 拟议锁 | An explicit restatement of a settled choice with its boundary and exceptions, submitted for user confirmation before freezing. | 将用户初步方向转化为严谨边界与例外说明的重述文本，供用户确认后正式冻结。 | ≠ `Direction` |
| `TreeFact` | 树中事实 | A verifiable codebase, documentation, or dependency fact that the agent must inspect autonomously without asking the user. | 代码库、文档或架构树中客观存在的事实，Agent 必须自行查证，严禁抛给用户确认。 | ≠ `DesignDecision` (设计决策) |
| `RecomputeFrontier` | 前沿重算 | Recalculating the decision tree after a batch round to uncover newly unblocked questions. | 在收到上一轮回答并确立锁后，重新计算依赖树以提取下一轮独立决策点的过程。 | ≠ `AdHocQuestioning` (随想随问) |

## Boundary Rules

1. **Facts vs Decisions**: Never ask the user about facts observable in code, config, or docs (`TreeFact`); ask only about product, domain, architecture, or policy choices.
2. **No Mid-Grill Implementation**: Never start coding during a `GrillLoop` until all frontier decisions are resolved or explicitly deferred.
3. **No Dependent Question Batching**: Never put a question in the same `FrontierBatch` if its formulation depends on the answer to another question in that same batch.

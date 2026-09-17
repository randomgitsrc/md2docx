---
title: 回归用例B（plantuml 块非法）
company: 测试公司
date: 2026年9月
---

# 回归用例B

## 缺 @startuml 的块（应降级为代码块，绝不可嵌入文档A的图）

```plantuml
component 这段没有 startuml 标记
@enduml
```

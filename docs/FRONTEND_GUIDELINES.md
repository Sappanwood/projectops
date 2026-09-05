# Workbench 前端规范

## 样式职责

- `src/web/theme.css` 定义当前深色主题的颜色、字体、焦点和控件变量，以及原生控件的低 specificity 基础规则。
- `src/web/style.css` 定义页面布局和组件，包括按钮层级、筛选排列和模型选择容器。
- `src/web/foundation.css` 定义编辑／执行面板的局部排版；不得重复维护另一套输入颜色、边框与字体。
- 保留原生 TypeScript、ESM、HTML 和 CSS 技术栈。新功能先复用规则，避免逐页面复制声明或添加 `!important`。

## 表单控件

原生 `input`、`textarea`、`select` 自动继承主题。输入使用 `.form-input`、选择器使用 `.form-select` 作为现有语义标记；不依赖所在面板才能获得主题。checkbox/radio 保留原生尺寸与操作，使用主题 accent。

使用真实 `label` 包裹控件或以 `for` 关联 ID。包裹的文本输入和 textarea 默认另起一行并占满可用宽度；select 由紧凑工具栏或表单布局决定宽度。长文本输入在控件内滚动，textarea 仅允许纵向拉伸。帮助文本使用 `.form-help`，与字段关系需要时用 `aria-describedby` 明确关联。现有面板的直接说明段落保持次要文字层级。

| 状态 | 使用与表现 |
|---|---|
| normal / hover | 深色输入背景、可辨识边框；可编辑控件 hover 提亮边框 |
| focus-visible | 保留全局 2px 焦点轮廓；不得清除 outline，键盘 Tab 顺序遵循 DOM |
| disabled | 原生 disabled 禁止交互、显示次要颜色与禁用光标；按钮禁用不响应 hover |
| readonly | 使用原生 readonly；虚线边框区分不可编辑，但允许聚焦、选择与复制 |
| error | 已明确无效的字段使用 `aria-invalid="true"`；错误说明用文字描述并关联字段，不能仅靠颜色 |

现有 Plan JSON 解析／revision 反馈沿用 `.reading-notice[role="status"]`；它同时承载成功与失败信息，不能将整个类统一涂为错误色。执行错误的 `role="alert"` 使用共享错误边线与背景。不要为显示颜色改变业务状态或把尚未提交的字段全部标成 invalid。

按钮使用 `.btn` 与 `.btn-primary`／`.btn-secondary`，长按钮文字允许换行。主操作优先级由页面工作流决定；任务目录和列表选择按钮保留各自导航样式。控件高度至少 2.5rem；页面不得通过缩小字体或压缩基础控件填入更多功能。

## 布局例外与验证

允许的例外是具体内容需求：Plan JSON 编辑器使用等宽字体，筛选工具栏在宽屏排列、窄屏按 label／control 顺序纵排，模型选择器约束长模型名的宽度。原生 select 弹层、选项字体和长选项呈现部分由操作系统决定；不要为外观一致性重做自定义下拉控件。

编辑／运行面板只约束局部布局；Plan 信息层级和串行／并行区块组织属于页面设计，不在基础控件层通过选择器补丁实现。

涉及共享控件的改动，在隔离 workspace 的真实浏览器中检查 Backlog 编辑、Plan 修订和运行、模型选择、回顾筛选。宽度至少覆盖 1440、1024、390px，使用长文本检查容器宽度、标签和帮助文字换行、焦点、hover、disabled、readonly，以及已有错误反馈。执行提交／筛选与键盘 Tab smoke；截图必须实际查看，样式值断言不能代替视觉判断。人工设置的 readonly／aria-invalid 只用于查看状态，不代表现有业务已经提供这些状态。

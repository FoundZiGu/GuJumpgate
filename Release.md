# GuJumpgate v0.1.6

发布日期：2026-05-27

本次版本聚焦三件事：把 SMS OAuth 流程更完善，补齐更多可 API 化的邮箱/接码供应源，并把 PayPal Hosted Checkout、手机号验证和批量自动运行中的高频中断点做成可恢复、可重试、可观察的链路。

## 本次更新

- 版本号升级到 `0.1.6`，发布版本为 `GuJumpgate V0.1.6`。
- Plus OAuth 流程新增并固化两种手机号接入策略：
  - `先手机号注册 Oauth`：手机号注册后先创建 Hosted Checkout，再刷新 OAuth、绑定邮箱并完成平台回调。
  - `后手机号绑定 Oauth`：邮箱注册后先创建 Plus Checkout，再刷新 OAuth、完成手机号验证并回调。
- OpenAI / Plus 步骤定义重新编排，`sms_oauth` 与 `phone_bind_oauth` 两条链路都调整为更贴近真实页面状态的顺序，减少在手机号验证、确认 OAuth、平台回调之间来回跳转造成的失败。
- 邮箱源扩展到更多可 API 轮询场景：
  - 新增 `iCloud Mail` 邮箱支持。相关 PR：[ #90](https://github.com/FoundZiGu/GuJumpgate/pull/90)
  - 新增 `freemail`，支持后台登录、拉取域名、生成邮箱、直接 API 轮询验证码。相关 PR：[ #81](https://github.com/FoundZiGu/GuJumpgate/pull/81)
  - 新增 `Outlook Email Plus`，支持邮箱池认领、验证码轮询、认领释放，以及 PayPal 别名复用。相关改动入口：[Pull Requests](https://github.com/FoundZiGu/GuJumpgate/pulls)
  - `bind-email`、注册验证码、登录验证码链路已接入 `Cloudflare Temp Email / Cloudmail / freemail / Outlook Email Plus / iCloud API` 的统一处理。
- 手机接码平台扩展与配置拆分：
  - 平台从 `HeroSMS / 5sim / NexSMS` 扩展到 `HeroSMS / 5sim / NexSMS / SMSBower / SMS Verification Number / GrizzlySMS / SMSPool / ChatGPT API 接码`。
  - 每个平台改为使用自己的 API Key、Base URL、国家、价格区间、优先价格等字段，不再共享 HeroSMS 配置。
  - `HeroSMS / 5sim / SMSBower / SMSPool` 增加或补齐复用能力；复用号码会忽略历史旧码，只等待新验证码。
  - HeroSMS 默认国家调整为 Colombia，并扩展多国候选映射。
- ChatGPT API 接码池增强：
  - 支持批量导入“手机号 + 验证码接口”。
  - 支持按使用次数、当前号码、启用状态、异常状态筛选。
  - 支持失败自动禁用，并按手机号前缀推断国家。
  - 同一号码默认限制成功使用次数，避免坏号或过度重复使用。
- 手机号验证链路增强：
  - 新增免费复用号码能力，支持手动复用和自动复用。
  - 自动复用前会先完成当前号码提交，替换号码前会先取消旧复用订单，避免状态串线。
  - 新增 WhatsApp 验证页识别与自动重启开关；当页面直接落到 WhatsApp 通道时，可按配置快速回到可重试路径。
  - 停止流程时可选是否自动释放当前接码订单，同时会清空手机号运行态和验证码倒计时缓存。
- PayPal Hosted Checkout 稳定性增强：
  - 新增“首次直接重发”、首次等码秒数、后续等码秒数、轮询次数、轮询间隔、Resend 上限等细粒度配置。
  - Hosted Checkout 验证码池支持自动禁用失败号码并自动切换下一个号码。
  - `genericError` 发生后会先刷新 ChatGPT 会话检查 Plus 是否已生效；未生效时再自动清理 PayPal 会话 Cookie 并重建 Checkout。
  - Cloud Checkout 读取 `accessToken` 失败时会自动刷新会话页重试；Cloud Checkout API 遇到短暂 `5xx` 会自动重试。
  - 增加 PayPal blocked、银行卡分支、Guest Checkout 卡错误、手机号错误、地址错误等更多异常识别。
- Checkout 与 OAuth 恢复能力增强：
  - Checkout 联系邮箱会自动填入当前注册邮箱。
  - 账单地址 iframe、订阅按钮 iframe、页面 `document.complete` 等等待点超时后会输出更明确的 frame 摘要和错误信息。
  - `confirm-oauth` 在回退到 verification/add-email 页面时，支持自动恢复一次并继续完成 localhost 回调。
  - 重新登录已绑定邮箱时，会强制覆盖旧 session 身份，避免错误沿用旧手机号身份。
  - `reuseOrCreateTab` 会先创建替换标签页，再移除最后一个冲突页，降低流程被误清空的概率。
- 自动运行增强：
  - 新增“非免费试用自动换新邮箱重试”能力。
  - 同一轮继续使用当前邮箱的重试次数加入上限保护，避免单轮无限循环。
  - PayPal `genericError`、验证码 Resend 达上限、手机号验证中断等场景会给出更明确的停止原因。
  - 自动重启下游步骤时会清理验证码缓存，减少旧验证码干扰。
- Hotmail Helper、文档与侧边栏同步更新：
  - 本地 helper 新增 `GET /health` 健康检查，CORS 允许 `GET, POST, OPTIONS`。
  - Windows 启动脚本补充 Python 版本检查、端口占用检查、启动日志和 bundled Python 识别。
  - 侧边栏增加 `freemail / Outlook Email Plus / 免费复用 / WhatsApp 重启 / 非试用自动重试` 等配置入口。
  - `RELEASING.md`、README、使用说明同步更新到 `v0.1.6` 的能力描述。

## 修复内容

- 修复 SMSPool、SMSBower、GrizzlySMS 等平台误读 HeroSMS 价格字段的问题。
- 修复手机号注册后绑定邮箱时，邮箱缺失会导致流程卡住的问题。
- 修复登录验证码目标邮箱被瞬时清空后，步骤仍可能错误读取旧身份的问题。
- 修复 PayPal Hosted Checkout 验证码接口返回历史验证码时仍被当作新码消费的问题。
- 修复 PayPal Hosted Checkout 落到银行卡或异常页面时缺少明确失败原因的问题。
- 修复平台回调阶段使用旧状态判断结果的问题，改为基于最新状态合并后再决定后续分支。
- 修复 WhatsApp 文案、发送渠道识别和 resend 文本干扰导致的手机号验证误判。
- 修复自动运行在同邮箱重试、非试用自动重试和 stop 后接码运行态残留时的状态错乱问题。

## 测试覆盖

- 新增邮箱源相关测试，覆盖 `freemail`、`Outlook Email Plus`、`iCloud API`、手机号注册后自动绑定邮箱、Outlook 别名复用和认领释放。
- 新增手机号链路测试，覆盖免费复用号码、WhatsApp 页面重启、停止流程时自动释放接码订单、发送渠道识别和接码平台复用行为。
- 新增支付与恢复链路测试，覆盖 PayPal `genericError` 恢复、Cloud Checkout 重试、Hosted Checkout 验证码轮询、Checkout iframe 超时、OAuth 回退恢复和标签页替换逻辑。
- 已执行 `node --test tests/*.test.js`，共 `111` 个用例通过。

## 升级注意

- 当前版本建议优先使用手机号 OAuth 接码策略，`SESSION 拿 AT` 路线不再作为推荐方案。
- 如果你的手机号页频繁落到 WhatsApp 通道，可根据实际情况开启或关闭“WhatsApp 页面自动重启”。
- 使用 `Outlook Email Plus` 时，建议根据实际池子容量配置单邮箱可用别名上限；使用 `freemail` 时需要先正确配置服务地址、管理员账号和域名。
- 使用 Hosted Checkout 接码池、ChatGPT API 接码池或免费复用号码时，建议同时开启自动禁用/自动释放，减少坏号重复进入流程。
- Windows 用户如 Hotmail Helper 无法启动，可访问 `http://127.0.0.1:<端口>/health` 检查本地服务状态。

# dsh-coc-kp

克苏鲁的呼唤（Call of Cthulhu）第 7 版守秘人（KP）工具插件，运行在
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上。

**纯后端工具插件**：12 个工具全部只返回符合 schema 的 JSON 对象，不返回自然语言或
Markdown，叙事由调用方 AI 负责。数据持久化使用 `better-sqlite3`（同步 API），数据库
文件位于插件目录下的 `data.db`。

## 安装

```bash
# 在插件包目录内构建
pnpm install
pnpm build

# 在 Harness 中安装（本地目录会以链接方式加入当前 profile）
# 通过 Plugin Manager 的 install_bundle 指向本目录即可
```

安装后插件在 `desktop` profile 的所有会话中生效，插件清单里显示
「CoC 7版守秘人工具」。

## 数据声明

本仓库内置的规则数据（怪物、法术、武器、疯狂表等）**以结构化数据库 / JSON 字段形式
保存**（数值、判定条件、索引与机制描述），只用于跑团工具的计算与查询，**不包含规则书
的原文正文、排版内容或插图**。若权利人认为其中部分条目需要调整或移除，欢迎通过
issue 联系，我们会及时处理。

## 工具一览

| 工具 | 作用 | 返回 JSON |
| --- | --- | --- |
| `roll_check` | CoC 7e 技能/属性判定（奖励骰/惩罚骰） | `{ tens_rolls, ones_roll, final_result, success_level, is_success }` |
| `push_roll` | 村规·孤注一掷：target = min(技能, 50) | `{ roll, target, result }` |
| `sanity_check` | 理智检定并扣除、写回 SAN | `{ roll, is_success, san_loss, current_san }` |
| `roll_madness` | 疯狂表查表（ti/li；恐惧/躁狂条目自动补抽 1D100） | `{ roll, symptom }` |
| `skill_growth` | 官方技能成长（d100 > 当前值则 +1d10） | `{ success, growth, new_value }` |
| `manage_tags` | 代死标签增删 | `{ updated_tags }` |
| `get_snapshot` | 群内全员 HP/SAN/标签快照 | `{ characters: [{ char_name, hp, san, tags }] }` |
| `manage_npc` | 怪物模板/实例/HP 变化 | 模板或实例对象 |
| `lookup_weapon` | 武器库查询（26 件：近战/手枪/步枪/冲锋枪/爆炸物） | 武器对象或候选列表 |
| `lookup_spell` | 法术查询（545 条纯机制数据，含 `manual_review_needed` 标记） | 法术对象或候选列表 |
| `lookup_npc` | 怪物图鉴查询（253 种：属性/战斗/护甲/理智损失等完整资料） | 怪物对象或候选列表 |
| `manage_character` | 角色卡建档/读取/修改/删除（见下方说明） | 角色卡对象或删除确认 |

所有失败（角色不存在、表达式无法解析、数据库异常、权限不足等）都以
`{ "error": "…" }` 返回，不会抛出、不会中断对话轮次。

## 配置

### 本地 KP 身份（推荐，不会被提交到 git）

复制 `kp.config.example.json` 为 `kp.config.json`（该文件在 `.gitignore` 里），填写
自己的 KP QQ 号与群内昵称：

```json
{
  "kp_qq_id": "123456789",
  "kp_nickname": "群里的 KP 昵称"
}
```

- `kp_qq_id`：只有该 QQ 号能通过 `manage_npc` 的 `create_template` 创建模板。
- `kp_nickname`：群内 KP 的昵称，会显示在 `manage_npc` 的工具描述里，方便 AI 知道谁是 KP。
- 优先级：`kp.config.json` > 插件配置（Harness 插件设置里的 `kp_qq_id` /
  `kp_nickname`）> 环境变量 `KP_QQ_ID`。
- 配置文件路径可用环境变量 `DSH_COC_KP_CONFIG` 改成其他位置。
- 该文件在插件启动时读取，改完需要重启/重载插件（Plugin Manager 里关开一次）才生效。

### 插件配置（`cordis.patch.yml`）

```yaml
- insert:
    - id: dsh-coc-kp
      name: dsh-coc-kp
      config:
        fumble_rule: auto   # auto | 96-100 | only-100
        kp_qq_id: ''        # 建议留空，写在 kp.config.json
        kp_nickname: ''     # 建议留空，写在 kp.config.json
```

- **`fumble_rule`（大失败规则，可设置）**
  - `auto`（默认，官方 CoC 7e）：技能 ≥ 50 时只有 100 大失败，技能 < 50 时 96–100 大失败；
  - `96-100`：任何技能值下 96–100 都是大失败；
  - `only-100`：任何技能值下只有 100 是大失败。
- `kp_qq_id` / `kp_nickname`：仓库里的默认值为空，个人值请放本地 `kp.config.json`。

数据库路径默认 `<插件目录>/data.db`，可用环境变量 `DSH_COC_KP_DB` 覆盖（测试时用
`:memory:` 亦可）。

## 数据来源与规则口径

- **骰点规则**：`src/rules.ts` 的纯函数实现，可注入随机源（可测试）。判定顺序为
  1–5 大成功 → 大失败 → ≤技能/5 极难 → ≤技能/2 困难 → ≤技能 成功 → 失败。
- **疯狂表**：`src/data/madness.ts` 由用户提供的 `表.txt` 逐字生成
  （`scripts/import-tables.mjs`），没有原创条目。`ti` = 临时性疯狂·即时症状（1D10），
  `li` = 长期性疯狂·总结症状（1D10）。抽到「恐惧」或「躁狂」条目时，按表内说明自动
  补抽恐惧/躁狂 1D100 并把结果附在 `symptom` 中。`7r` 已按需求取消，未暴露。
- **恐惧症状表**：1–69 项为规则书原文，70–100 项为用户提供的补全版，待官方原文到位后替换。
- **怪物图鉴**：`src/data/bestiary.ts` 由 `表.txt`（35 种）与新怪物文件
  `新怪物.json`（218 种新增）逐字生成，首次建库自动导入 `NPC_Templates`，共 **253 种**；
  完整资料保存在模板的 `attributes` JSON 列，`hp/mp/db/build` 从「衍生」列尽力解析
  （缺失的 Build/MP 取默认值，以 `attributes` 原文为准）。
  - 同名去重规则：**16 个重复名字采用 `新怪物.json` 的新版本**；其中
    「加塔诺托亚 / 尼约格达 / 巴斯特 / 诺登斯」4 条经 7e 衍生值核对后保留 `表.txt`
    的版本（新版 HP/MP/DB 与 `HP=(CON+SIZ)/10`、`MP=POW/5`、STR+SIZ→DB 的规则不符，
    且 `尼约格达` 的新版数值与 `暗之恶魔` 完全相同，属复制串行）。
  - 保留 `表.txt` 版本的条目会额外并入新版里的 `咒文 / 特殊能力` 文本，避免丢信息。
  - `新怪物.json` 的「属性」是骰式（如 `5D6 (17-18)`），原样保留；字段
    `咒文 / 特殊能力` 也原样保留。
  - 可用 `manage_npc` 直接实例化「拜亚基」「深潜者」「克苏鲁」等。
- **武器库**：`src/data/weapons.ts` 由 `表.txt` 的「武器库」逐字生成，首次建库自动导入
  `Weapons`（26 件，5 类），由 `lookup_weapon` 查询。
- **法术表**：`src/data/spells.ts` 由用户提供的 `coc_spells.json`（545 条纯机制抽取）
  逐字生成，首次建库自动导入 `Spells`，由 `lookup_spell` 查询。7 条被抽取器标记
  `manual_review_needed: true` 的法术会原样返回该标记，提醒调用方效果可能不完整。
  两条 `raw_text` 附注也会随法术返回。

## 与任务书的差异（已确认）

1. **表结构**：任务书里的 `hpmax_hp`、`current_hpcurrent_mp`、`hpmpdbbuild` 是分隔符
   丢失的粘连写法，本实现拆成 `hpmax/hp`、`mpmax/mp`、`sanmax/san`、
   `current_hp/current_mp`、`hp/mp/db/build`。其中 `NPC_Templates.db` 使用 TEXT 保存
   `+1D6` 这类伤害加值（官方数据不是整数），其余字段按任务书为 INTEGER。
2. **`manage_character`（第 9 个工具）**：任务书的 8 个工具没有建档/读卡入口，
   `sanity_check`、`skill_growth`、`manage_tags` 无法实际使用，因此补充
   `create/get/update/delete`。
3. **`lookup_weapon` / `lookup_spell` / `lookup_npc`（第 10–12 个工具）**：按需求新增，
   把 `表.txt` 武器库、`coc_spells.json` 法术表与怪物图鉴入库后提供查询；三者都支持
   精确匹配、模糊候选列表，武器/怪物还支持分类过滤。
3. **`manage_npc` 参数**：`qq_id` / `npc_name` 改为按 action 校验（create_template 需要
   KP 权限与模板名；create_instance 需要模板名；update_hp 需要 instance_id 与 hp_change），
   避免为 update_hp 强制传无关参数。
4. **`hp_change` 语义**：变化量（负数扣血、正数回血），HP 归零时实例状态置为 `dead`。
5. **`roll_madness` 的 `7r`**：任务书枚举被粘贴损坏，经确认取消该表，枚举为 `ti | li`。

## 打包与分发给别人

### 方式 A：npm tarball（推荐，无需发布到 registry）

```bash
pnpm build
pnpm pack --pack-destination release
# 产出 release/dsh-coc-kp-0.1.0.tgz
```

把 tgz 发给对方，对方在 DSH 的 Plugin Manager 里用「安装本地 bundle」指向该文件
（或调用 `install_bundle` 传 tgz 路径）即可。安装后让对方在插件目录里把
`kp.config.example.json` 复制成 `kp.config.json`，填自己的 KP QQ 号与群内昵称
（这个文件不会被提交到 git）。

> 本机实测：tarball 安装步骤在当前机器上被 DSH profile 目录写权限挡住（`EPERM`），
> 属于本机环境问题。链接目录安装（方式 C）已实测可用；发给别人时请让对方确认安装结果。

### 方式 B：发布到 npm

```bash
npm publish
```

对方 `install_bundle` 的 target 填 `dsh-coc-kp`（或 `dsh-coc-kp@0.1.0`）即可。
注意包名需在 npm 上可用。

### 方式 C：源码包（给开发者）

把整个目录（**不含** `node_modules/`、`data.db*`、`release/`）打包发送；对方执行
`pnpm install && pnpm build`，再 `install_bundle` 指向目录。

### 兼容性与注意

- 要求 Node ≥ 20。`better-sqlite3@13` 随包提供 win32 / linux / darwin × x64 / arm64
  的 N-API 预编译二进制，对方机器**不需要**编译工具链。
- 在 DSH `0.2.2-rc.1` 上实测可用；其他 DSH 版本未验证。
- 分发包**不包含** `data.db`：首次调用工具时自动建库，并导入内置的 253 种怪物、
  26 件武器、545 条法术。
- 版权：代码为 MIT；CoC 规则数据（属性/法术/怪物/武器/疯狂表）版权归 Chaosium
  及其中文出版方，仅限个人跑团使用，公开发布或商用前请确认授权（详见 `LICENSE`）。

## 上传到 GitHub / Gitee

仓库已带 `.gitignore`（排除 `node_modules/`、`dist/`、`release/`、`data.db*`、沙箱与
原始规则数据文件）。`dist/` 不入库，协作者/使用者拉取后自行 `pnpm install && pnpm build`。

**建议建私有仓库**：`src/data/*.ts` 内含 CoC 规则数据，公开发布有版权风险（见 `LICENSE`）。

1. 先在网页端新建空仓库（GitHub 或 Gitee，不要勾选自动生成 README/.gitignore）。
2. 本地首次提交并推送：

```bash
cd "D:\观测档案馆\Jeremy's program\骰子插件"

git init
git config user.name  "你的名字"
git config user.email "你的邮箱"

git add .
git commit -m "dsh-coc-kp 0.1.0"

# GitHub（主分支习惯叫 main）
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-coc-kp.git
git push -u origin main

# 或 Gitee（主分支习惯叫 master；地址换成 gitee 的）
git branch -M master
git remote add origin https://gitee.com/<你的用户名>/dsh-coc-kp.git
git push -u origin master
```

- **认证**：GitHub 用 Personal Access Token（Settings → Developer settings →
  Tokens (classic)，勾 `repo`）或 SSH key；Gitee 用账号密码或私人令牌。首次 push 时
  Git 会弹窗/提示输入。
- **你的个人配置不会上传**：`cordis.patch.yml` 里 `kp_qq_id`/`kp_nickname` 已留空；
  你本机的 QQ 与群昵称在 `kp.config.json` 里，该文件已被 `.gitignore` 忽略。
- **发给别人**：对方 `git clone` 后执行 `pnpm install && pnpm build`，复制
  `kp.config.example.json` 为 `kp.config.json` 填上自己的 KP 信息，再用
  `install_bundle` 指向目录；或者你把 `release/dsh-coc-kp-0.1.0.tgz` 传到
  GitHub Releases / Gitee 附件，对方下载后安装。
- 版本更新：改 `package.json` 的 `version` → `git commit` → `git tag v0.1.1` →
  `git push --tags`，需要的话再新建 Release。

## 开发

```bash
pnpm build        # tsc -> dist/
pnpm test         # 本地校验（规则/数据/数据库/11 个工具接线）
pnpm import:tables  # 从 表.txt + coc_spells.json 重新生成 src/data/*.ts
```

`test/smoke.mjs` 覆盖规则、数据与数据库；`test/tools.mjs` 用假 Cordis 上下文
挂载插件并逐个执行 12 个工具（含错误路径与候选列表）。

种子数据只在 Meta 记录的版本号变化时导入；更新 `表.txt`、`新怪物.json` 或
`coc_spells.json` 后，重新运行 `pnpm import:tables` 并提升 `src/db.ts` 中对应的
`*_SEED_VERSION`（或清空对应表与 Meta 行）即可让已存在的 `data.db` 重新导入。

目录：

```
src/db.ts              SQLite 初始化、建表、种子数据与 CRUD
src/rules.ts           CoC 7e 纯掷骰规则（可注入 rng）
src/config.ts          本地 kp.config.json 读取（KP QQ / 群昵称，git 忽略）
src/index.ts           defineTool 注册与 execute 逻辑
src/data/madness.ts    疯狂/恐惧/躁狂表（由 表.txt 生成）
src/data/bestiary.ts   怪物图鉴（由 表.txt 生成）
src/data/weapons.ts    武器库（由 表.txt 生成）
src/data/spells.ts     法术表（由 coc_spells.json 生成）
cordis.patch.yml       bundle 补丁（插件行 + 默认配置）
kp.config.example.json 本地 KP 配置模板（复制为 kp.config.json 使用）
locale/{en,zh}.json    插件清单标题与描述
icon.svg               插件图标
```

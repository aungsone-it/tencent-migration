# NEXA Platform — Client Instructions / 客户使用说明

**Document type / 文档类型:** User manual · 用户手册  
**Audience / 适用对象:** Customers, vendors, and platform staff · 顾客、商家与平台员工  
**Languages / 语言:** English + 简体中文 (Simplified Chinese)

---

## Table of contents / 目录

1. [Overview / 概述](#1-overview--概述)
2. [Customer guide / 顾客指南](#2-customer-guide--顾客指南)
3. [Vendor guide / 商家指南](#3-vendor-guide--商家指南)
4. [Super admin guide / 超级管理员指南](#4-super-admin-guide--超级管理员指南)
5. [Reference / 参考](#5-reference--参考)

---

## 1. Overview / 概述

### 1.1 What is NEXA? / NEXA 是什么？

NEXA Platform is an online shopping system where **each store has its own website**.

NEXA 平台是一个在线购物系统，**每家店铺都有独立的网店**。

- One **main website** (`https://www.nexa-mm.com/`) helps people find stores and run the platform.
- 一个**主站**（`https://www.nexa-mm.com/`）用于发现店铺并管理平台。
- Each **vendor (seller)** has a **separate shop link** — like an independent mini-store.
- 每位**商家**拥有**独立的店铺链接**，类似独立小店。
- Customers shop **one store at a time**. There is no single mixed marketplace catalog.
- 顾客**一次只逛一家店**，没有混合所有商家的统一商城目录。

**Platform catalog model / 平台商品目录模式**

- Super admin maintains one **platform product catalog** (names, prices, stock, images, SKU, status).
- 超级管理员维护统一的**平台商品目录**（名称、价格、库存、图片、SKU、状态等）。
- Each vendor **selects products from that catalog** to sell in their store — vendors do not create or edit catalog data.
- 每位商家从该目录中**挑选商品**在本店销售 — 商家不能创建或编辑目录数据。
- Vendors create **store categories** and assign selected products for storefront tabs.
- 商家创建**店铺分类**并将已选商品分配到分类，用于前台分类标签。

### 1.2 User roles / 用户角色

| Role 角色 | Responsibility 职责 |
|-----------|----------------------|
| **Customer** 顾客 | Browse products, manage cart, checkout, track orders · 浏览商品、购物车、结账、查看订单 |
| **Vendor** 商家 | Select products from platform catalog, manage categories, orders, branding · 从平台目录选品、管理分类、订单与品牌 |
| **Super Admin** 超级管理员 | Manage the whole platform — vendors, orders, staff, settings · 管理全平台商家、订单、员工与设置 |

### 1.3 Where customers shop / 顾客在哪里购物

Customers **do not** shop from a product list on the main homepage.

顾客**不会**在主站首页的商品列表中购物。

The main site shows platform information, a **vendor logo carousel** (click to open a store), and links to apply or sign in.

主站展示平台信息、**商家 Logo 轮播**（点击进店）以及入驻/登录入口。

**To buy something / 如何购买：**

1. Open a vendor’s store link (e.g. `https://gogo.nexa-mm.com/`) **or** click a vendor logo on the homepage carousel.
2. 打开商家店铺链接（如 `https://gogo.nexa-mm.com/`），**或**点击首页轮播中的商家 Logo。

Each store sells **only its own products**.

每家店**只销售本店商品**。

---

## 2. Customer guide / 顾客指南

### 2.1 Opening a store / 打开店铺

| Method 方式 | Example 示例 |
|-------------|--------------|
| Vendor subdomain 商家子域名 | `https://gogo.nexa-mm.com/` |
| Custom domain 自定义域名 | `https://yourstore.com/` |
| Main site carousel 主站轮播 | Click a vendor logo · 点击商家 Logo |

On the store you can browse products, search, switch **English / Burmese**, contact the store (**Dial** or **Viber**), and use the **chat bubble** (bottom-right).

在店铺内可浏览商品、搜索、切换**英语/缅甸语**、通过**电话或 Viber** 联系商家，并使用右下角**聊天按钮**。

### 2.2 Browsing and searching / 浏览与搜索

**Home page / 首页**

- Products with optional banner; **category tabs**; **Load more** when needed.
- 商品列表与横幅；**分类标签**；商品多时可点**加载更多**。
- Tap a product → details; **Back** restores scroll position.
- 点击商品查看详情；**返回**时恢复列表滚动位置。

**Product page / 商品页** — photos, price, stock, **Add to Cart**, **Saved / Wishlist** (heart).

**Search / 搜索** — type in the search box; results update as you type.

### 2.3 Cart and saved items / 购物车与收藏

- **Guest** cart stays on this device · **访客**购物车仅保存在本设备。
- **Signed in** cart syncs across devices · **登录后**购物车可跨设备同步。
- Heart icon saves items to **Saved / Wishlist** · 心形图标加入**收藏/心愿单**。
- **Wishlist requires sign-in** — guests are prompted to log in · **收藏需登录** — 访客会提示登录

### 2.4 Account and profile / 账户与个人资料

**Benefits of signing in / 登录的好处：** order history, saved addresses, synced cart and wishlist.

**Forgot password / 忘记密码：** email → **OTP code** → new password. Check spam if email is delayed.

### 2.5 Checkout / 结账

1. **Cart** → **Checkout** · **购物车** → **结账**
2. Shipping address and phone · 收货地址与电话
3. **Delivery region / township and delivery partner** (required before payment; still required when shipping is free) · **配送区域/乡镇及配送方式**（付款前必选；免运费时也需选择）
4. **Free shipping:** when every item qualifies → **FREE (0 MMK)** and delivery partner is locked to free shipping · **免运费：** 全部符合免运费商品时显示 **免费（0 缅元）** 并锁定免运费配送
5. **Cash on Delivery (COD)** or **KBZPay** — COD appears only when your region/partner supports it · **货到付款** 或 **KBZPay** — 货到付款仅在区域/物流支持时显示
6. Review and **Place Order** / **Pay with KBZPay** · 确认后**下单**或**KBZPay 支付**

### 2.6 Cash on Delivery / 货到付款

Order created immediately; pay cash on delivery. Track under **Profile → Orders**.

订单立即创建；收货时现金支付。可在**个人资料 → 订单**中跟踪。

### 2.7 KBZPay

- **Desktop:** pay via **KBZPay QR** on the checkout page · **桌面端：** 结账页 **KBZPay 二维码**
- **Mobile:** pay via **KBZPay app / PWA** · **手机端：** **KBZPay 应用 / PWA**
- After payment you may land on the platform apex **`/summary`** (e.g. `https://nexa-apex.online/summary` or your deployment apex) — tap **Continue Shopping** to return to the store · 支付后可能跳转到平台主站 **`/summary`** — 点**继续购物**返回店铺

Keep the browser open until payment finishes. Contact the store with receipt if payment succeeded but no order appears.

支付完成前请勿关闭浏览器。若已扣款但无订单，请联系商家并提供凭证。

### 2.8 Order history / 订单记录

**Profile:** Orders, Addresses, Account settings · **个人资料：** 订单、地址、账户设置。

### 2.9 Contact and support / 联系与客服

**Chat bubble**; **Dial** or **Viber** from phone menu. Provide order number, store name, and payment screenshot when needed.

**聊天**；电话菜单中的**拨打**或 **Viber**。联系时请提供订单号、店铺名称及支付截图。

### 2.10 Add store to home screen / 添加到主屏幕

**Android (Chrome):** **Add to Home** above chat · **Android：** 点击聊天上方的**添加到主屏幕**。

**iPhone (Safari):** Share → Add to Home Screen · **iPhone：** 分享 → 添加到主屏幕（须使用 Safari）。

### 2.11 Language / 语言

Storefronts: **English** and **Burmese**. Admin dashboards: **English** and **Chinese** (does not change storefront language).

店铺前台：**英语**与**缅甸语**。管理后台：**英语**与**中文**（不影响顾客前台语言）。

---

## 3. Vendor guide / 商家指南

### 3.1 Getting started / 入门

1. Apply at `https://www.nexa-mm.com/vendor/application` · 在入驻页面申请
2. Wait for super admin approval · 等待超级管理员审核
3. Complete setup at `https://www.nexa-mm.com/vendor/setup` if prompted after approval · 审核通过后如提示，在 `https://www.nexa-mm.com/vendor/setup` 完成设置
4. Sign in at `https://www.nexa-mm.com/vendor/login` · 登录商家后台
5. Open **vendor admin** → **Products → Select Product** to pick items from the platform catalog · 进入**商家后台** → **商品 → 选择商品**，从平台目录选品

**Forgot password / 忘记密码:** **Forgot Password?** on login → `/reset-password?returnTo=/admin&account=vendor` → OTP email → new password.

**忘记密码：** 登录页 **Forgot Password?** → `/reset-password?returnTo=/admin&account=vendor` → 邮箱验证码 → 新密码。

| URL | Purpose 用途 |
|-----|--------------|
| `https://yourstore.nexa-mm.com/` | Customer shop · 顾客店铺 |
| `https://yourstore.nexa-mm.com/admin` | Vendor dashboard · 商家后台 |
| `https://www.nexa-mm.com/vendor/your-store-slug/admin` | Path-based admin (alternative) · 路径式后台（备选） |

### 3.2 Application form / 入驻表单

| Field 字段 | Requirement 要求 |
|------------|------------------|
| Application type 申请类型 | **Professional** (business) or **Influencer** · **专业商家** 或 **达人/网红** |
| Contact name 联系人 | At least 2 characters · 至少 2 个字符 |
| Phone 电话 | Myanmar: `+959…` or `09…` · 缅甸格式 |
| Email 邮箱 | Wait for **Email is available** · 显示**邮箱可用**后再提交 |
| Store description 店铺介绍 | At least 10 characters · 至少 10 个字符 |
| Bank details 银行信息 | Bank name and account details · 银行名称与账户信息 |
| Documents 证件 | **Professional:** business license upload · **Influencer:** ID document · **专业：** 营业执照 · **达人：** 身份证件 |

### 3.3 Admin dashboard / 管理后台

| Section 模块 | Purpose 用途 |
|--------------|--------------|
| Dashboard / Analytics 概览 | Sales overview · 销售概览 |
| Products → All Products 商品 → 全部商品 | **Select products** from platform catalog; read-only price/stock/status; remove from store; free shipping toggles · **从平台目录选品**；价格/库存/状态只读；从店铺移除；免运费开关 |
| Products → Categories 商品 → 分类 | **Create vendor categories** and assign selected products (storefront tabs) · **创建店铺分类**并分配已选商品（前台分类标签） |
| Orders 订单 | View, update status, **KBZPay draft recovery** panel · 查看、更新状态、**KBZPay 草稿恢复** |
| Customers 顾客 | Buyers linked to your store · 本店买家 |
| Subscriptions 订阅 | **Plans** and **Subscribers** (if enabled for your store) · **套餐**与**订阅用户**（如已开启） |
| Finances 财务 | Revenue, commission, **KBZPay withdrawal** · 收入、佣金、**KBZPay 提现** |
| Settings 设置 | Logo, banner, contact, terms · 标识、横幅、联系方式、条款 |

### 3.4 Commission rates / 佣金比例

**Default platform commission is 0%.** The platform takes nothing unless an admin sets a rate.

**平台默认佣金为 0%。** 除非管理员设置比例，否则平台不收取佣金。

| Level 层级 | Set by 设置方 | Default 默认 |
|------------|---------------|--------------|
| Vendor contract 商家合同 | Super admin on vendor profile · 超级管理员在商家资料中 | **0%** |
| Product 商品 | Super admin on product form · 超级管理员在商品表单中 | **Blank = no product rate**（uses vendor contract, then 0%）· **留空 = 无商品专属比例**（沿用商家合同，否则 0%） |
| Specific product 特定商品 | Admin enters a % on the product · 管理员在商品上填写百分比 | e.g. 15% on that product only · 例如仅该商品 15% |

**Resolution order per order line / 每条订单明细的优先级：** line snapshot → product rate (if set) → vendor contract → **0%**.

### 3.5 Finances and KBZPay withdrawal / 财务与 KBZPay 提现

Under **Finances / 财务** you can:

在**财务**模块可以：

- View revenue and commission · 查看收入与佣金
- See **available balance** eligible for withdrawal · 查看**可提现余额**
- Save your **KBZPay phone number** (Myanmar `09…` format) · 保存 **KBZPay 手机号**（缅甸 `09…` 格式）
- **Withdraw to KBZPay** when balance meets the minimum · 余额达到最低金额后可**提现至 KBZPay**

**Withdrawable earnings include / 可提现收入包括：**

- Orders in **ready-to-ship, fulfilled, shipped, or delivered** status with **payment collected** · 状态为**待发货、已完成、已发货、已送达**且**已收款**的订单
- **COD:** only after delivery (or marked paid) · **货到付款：** 送达后（或标记已付）
- **KBZPay:** only after payment confirmed · **KBZPay：** 支付确认后

**Before withdrawing / 提现前：**

1. You must be **signed in** (session token from login) · 必须**已登录**（登录后获得会话令牌）
2. If you see **“Session expired”**, sign out and sign in again · 若提示**“会话已过期”**，请退出后重新登录
3. Confirm or save your KBZPay phone, then tap **Withdraw now** · 确认或保存 KBZPay 手机号后点击**立即提现**

See technical detail: [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md).

### 3.6 Products and categories / 商品与分类

**Who creates product data? / 谁维护商品数据？**

Super admin creates and edits all catalog products (name, price, stock, images, SKU, status, commission rate). Vendors only **choose which catalog products appear in their store**.

超级管理员创建并编辑所有目录商品（名称、价格、库存、图片、SKU、状态、佣金比例）。商家仅**选择哪些目录商品在本店上架**。

**Products tab / 商品模块**

1. Tap **Select Product** → browse the **platform catalog** → check products to add to your store · 点击**选择商品** → 浏览**平台目录** → 勾选要上架的商品
2. Save — products are linked to your store (same catalog item can be sold by multiple vendors) · 保存 — 商品关联到本店（同一目录商品可被多个商家销售）
3. List view shows **read-only** price, stock, and status · 列表中**价格、库存、状态为只读**
4. **Remove from store** unlinks a product from your shop (it stays in the platform catalog) · **从店铺移除**仅取消本店关联（商品仍保留在平台目录）
5. **View** (eye icon) opens read-only product details · **查看**（眼睛图标）打开只读详情

**Categories tab / 分类模块**

1. **Create** a vendor category (name, cover, description) · **创建**店铺分类（名称、封面、描述）
2. **Assign products** that are already selected for your store · **分配**已在本店选中的商品
3. Assigned categories become **tabs on your storefront** · 已分配分类显示为**前台分类标签**
4. Super-admin product categories are **not imported** — use your own vendor categories · 不会导入超管商品分类 — 请使用商家自建分类

**Free shipping** (when super admin enabled access for your store): toggle per product on **Products**, or bulk toggle by category on **Products** / **Categories** · **免运费**（超管已开启权限）：在**商品**中按单品开关，或在**商品/分类**中按分类批量设置。

**Typical vendor catalog workflow / 典型选品流程**

1. **Products → Select Product** → add items from platform catalog · **商品 → 选择商品** → 从平台目录添加
2. **Categories** → create category → assign those products · **分类** → 创建分类 → 分配商品
3. **Preview / open store** to verify tabs, pricing display, and checkout · **预览/打开店铺**验证分类、价格展示与结账

### 3.7 Orders / 订单

Update order status through the lifecycle: **Pending** → **Processing** → **Ready to ship** → **Fulfilled** (shipping may also show **Shipped** / **Delivered**).

更新订单状态：**待处理** → **处理中** → **待发货** → **已完成**（物流可能显示 **已发货** / **已送达**）。

- **COD:** prepare and collect cash on delivery · **货到付款：** 备货并收货款
- **KBZPay:** verify payment before shipping · **KBZPay：** 确认到账后再发货
- **KBZPay draft recovery:** if a customer paid via KBZPay PWA but no order was created, use the amber recovery panel on **Orders** · **KBZPay 草稿恢复：** 若顾客已付但无订单，在**订单**页使用琥珀色恢复面板

### 3.8 Settings and sharing / 设置与推广

Configure logo, banner, phone, subdomain, custom domain, terms, and social links. Share **your store URL**, not the main site product list. Use **preview / open store** in admin to verify catalog, categories, checkout, and scroll restore.

配置 Logo、横幅、电话、子域名、自定义域名、条款与社交链接。分享**本店链接**，而非主站商品列表。在后台使用**预览/打开店铺**验证目录、分类、结账与滚动恢复。

---

## 4. Super admin guide / 超级管理员指南

### 4.1 Access / 访问

Open `https://www.nexa-mm.com/admin` and sign in with your staff account. Left menu (role-dependent):

打开 `https://www.nexa-mm.com/admin` 并使用员工账户登录。左侧菜单（因角色而异）：

**Home**, **Product** (Products, Categories, Inventory), **Orders**, **Vendor**, **Chat**, **Customers**, **Subscriptions** (Plans, Subscribers), **Finances**, **Logistics**, **Settings**.

**首页**、**商品**（商品/分类/库存）、**订单**、**商家**、**聊天**、**顾客**、**订阅**（套餐/订阅用户）、**财务**、**物流**、**设置**。

> **Note:** **Marketing** is not in the current menu (legacy route redirects to Home). · **营销**不在当前菜单中（旧路由重定向至首页）。

### 4.2 Admin user roles / 管理员角色

| Role 角色 | Access 权限 |
|-----------|-------------|
| **Store Owner** 店主 | Full access — all menus including **Finances** and **Settings → Users** · 全部权限 — 含财务与用户管理 |
| **Administrator** 管理员 | All menus **except Finances**; **Settings** (General + Activities, no Users tab) · 除财务外全部菜单；**设置**（常规+活动，无用户管理） |
| **Data Entry** 数据录入 | Home, Product, Categories, Inventory, **Chat**, Settings (General, no Users) · 首页、商品/分类/库存、**聊天**、设置（常规，无用户管理） |
| **Warehouse** 仓库 | Home, Orders, Inventory, Logistics only · 首页、订单、库存、物流 |

Only **Store Owner** can add staff under **Settings → Users**.

仅**店主**可在 **Settings → Users** 中添加员工。

### 4.3 Vendors / 商家管理

- New sellers apply at `/vendor/application`; approve via **Vendor → Review applications** · 新商家在入驻页申请；通过 **商家 → 审核入驻** 批准
- There is **no “Add vendor” button** — all vendors come through the application flow · **没有“添加商家”按钮** — 所有商家均通过入驻流程
- **Free shipping feature access** — toggle per vendor to enable/disable free-shipping controls in vendor admin · **免运费功能权限** — 按商家开关，控制商家后台是否显示免运费设置

### 4.4 Platform product catalog (super admin) / 平台商品目录（超级管理员）

Super admin owns the **platform product catalog** under **Products** and **Inventory**:

超级管理员在 **Products** 与 **Inventory** 中维护**平台商品目录**：

- Create, edit, delete products — name, description, images, **price**, **stock**, SKU, variants, status · 创建、编辑、删除商品 — 名称、描述、图片、**价格**、**库存**、SKU、规格、状态
- Assign one or more **vendors** on the product form (or via **Vendors → profile → Products** tab) · 在商品表单中分配**商家**（或通过 **Vendors → 商家资料 → Products**）
- Set **Commission Rate (%)** per product when needed (blank = vendor contract, then 0%) · 按需设置商品**佣金比例**（留空 = 商家合同，否则 0%）
- Enable **Free shipping feature access** per vendor · 按商家开启**免运费功能权限**

Vendors then pick from this catalog; they cannot change price or stock.

商家从此目录选品；不能修改价格或库存。

### 4.5 Vendor commission (super admin) / 商家佣金（超级管理员）

When creating or editing a vendor:

创建或编辑商家时：

- **Commission %** — platform take from that vendor's sales. **Default: 0%** when unset.
- **佣金 %** — 平台从该商家销售中抽取的比例。**未设置时默认为 0%。**
- Product-level commission overrides are set by **super admin** on individual products in the platform catalog (product form).
- 商品级佣金覆盖由**超级管理员**在平台目录的商品表单中设置。

### 4.6 Daily workflow / 日常工作

1. Review **Orders** (pending badge) · 查看**订单**（待处理角标）
2. Recover **KBZPay drafts** if needed · 必要时恢复 **KBZPay 草稿订单**
3. **Vendor → Review applications** · **商家 → 审核入驻申请**
4. **Settings → Activities** audit log · **设置 → 活动** 审计日志

### 4.7 Settings / 设置

| Tab | Purpose 用途 |
|-----|--------------|
| General 常规 | Platform name, logo, support · 平台名称、Logo、客服 |
| Users 用户 | Staff accounts (owner only) · 员工账户（仅店主） |
| Activities 活动 | Audit timeline · 操作审计 |

There is no separate **Appearance** tab; branding is under **General**.

没有单独的 **Appearance** 标签；品牌设置在 **General** 中。

---

## 5. Reference / 参考

### 5.1 Quick URLs / 常用链接

| Purpose 用途 | URL |
|--------------|-----|
| Main site 主站 | `https://www.nexa-mm.com/` |
| Super admin 超级管理 | `https://www.nexa-mm.com/admin` |
| Apply to sell 商家入驻 | `https://www.nexa-mm.com/vendor/application` |
| Vendor login 商家登录 | `https://www.nexa-mm.com/vendor/login` |
| Vendor setup 商家设置 | `https://www.nexa-mm.com/vendor/setup` |
| After KBZPay 支付后 | Platform apex `/summary` (e.g. `https://nexa-apex.online/summary`) |
| Password reset 重置密码 | `https://www.nexa-mm.com/reset-password` |
| Vendor password reset 商家重置密码 | `https://www.nexa-mm.com/reset-password?returnTo=/admin&account=vendor` |

### 5.2 Do’s and don’ts / 注意事项

**Do / 建议**

- Use the correct URL for your role · 使用对应角色的正确链接
- Sign in for order history · 登录以查看订单记录
- Update order status promptly · 及时更新订单状态
- Re-login if vendor withdrawal shows session expired · 提现提示会话过期时请重新登录

**Don’t / 避免**

- Expect one catalog on the main site · 不要在主站寻找统一商品目录
- Pay twice on KBZPay without checking orders · 未查订单前勿重复 KBZPay 支付
- Share staff passwords · 勿共享员工密码

### 5.3 Troubleshooting / 故障排查

| Problem 问题 | What to try 处理方式 |
|--------------|---------------------|
| Blank page 空白页 | Retry; use Chrome or Safari · 重试；换 Chrome 或 Safari |
| KBZPay paid, no order 已付无单 | Wait 1–2 min; check Profile → Orders · 等待 1–2 分钟；查订单 |
| Vendor withdraw session expired 提现会话过期 | Sign out and sign in again · 退出后重新登录 |
| Missing admin menu 缺少菜单 | Owner checks role in Settings → Users · 店主在 Users 中检查角色 |
| Add to Home fails (iPhone) | Safari → Share → Add to Home Screen · 使用 Safari 添加 |
| Application email check stuck 入驻邮箱验证卡住 | Refresh and try again · 刷新后重试 |
| Wishlist not saving 收藏无法保存 | Sign in first — wishlist requires an account · 请先登录 — 收藏需账户 |
| COD not available 无货到付款 | Your delivery region/partner may not support COD — try KBZPay · 配送区域可能不支持货到付款 — 请试 KBZPay |
| Category page empty 分类页空白 | Hard refresh; report if it persists · 强制刷新；仍有问题请反馈 |

### 5.4 Summary / 摘要

| Role 角色 | Flow 流程 |
|-----------|-----------|
| **Customer** 顾客 | Store → browse → cart → checkout → profile · 进店 → 浏览 → 购物车 → 结账 → 个人资料 |
| **Vendor** 商家 | Apply → admin → **select catalog products** → categories → orders → Finances withdraw · 入驻 → 后台 → **从目录选品** → 分类 → 订单 → 财务提现 |
| **Super Admin** 超管 | Admin → orders, vendors, settings · 管理后台 → 订单、商家、设置 |

---

*Related / 相关文档: [NEXA_SIMPLE_UI_INSTRUCTIONS.md](./NEXA_SIMPLE_UI_INSTRUCTIONS.md) · [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md) · [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md)*

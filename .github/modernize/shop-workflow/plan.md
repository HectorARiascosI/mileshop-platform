# MileShop real-shop workflow — implementation plan

**Status:** first batch implemented and verified; inventory, administration, and deployment phases remain planned.  
**Scope:** `mileshop-platform` only. This plan is separate from, and does not rewrite, the earlier inventory-reservation artifacts.

## Current-state evidence

- The storefront authenticates through server-side Next.js routes, stores the cart locally, and creates orders with an idempotency key.
- The gateway authenticates the customer and the orders service persists the order before returning it. The customer can read only their own order.
- Orders currently use `PENDING`, `CONFIRMED`, and `CANCELLED`; catalog stock is checked during order processing, but there is not yet a complete reservation, payment ledger, product-admin, or fulfillment workflow.
- The current repository worktree was already dirty across checkout, auth, gateway, orders, CI, and documentation. A feature branch was created without resetting, stashing, committing, or refreshing the worktree.
- Storefront baseline before this batch: `npm test --workspace apps/web` passed (5 tests); `npm run typecheck --workspace apps/web` passed.

## Reconciliation with earlier reservation artifacts

The 2026-10-30 `inventory-reservation-spec.md`, plan, and checkpoint remain preserved at their original session paths. Their checkpoint says 23 tasks completed, but that is not proof that those changes are present in this repository: this checkout does not contain several described pieces (for example, the persisted customer role and the payment-review UI). Do not mark those tasks complete or duplicate them without checking the actual tree.

This product request supersedes two old design choices:

1. Payment proof is **sent manually by the customer in WhatsApp**. Do not build private proof upload/storage, expose proof URLs, or claim a `wa.me` link can attach a file.
2. The old six-hour reservation is replaced by the policy below.

## Product and architecture decisions

1. **Order before chat:** persist the order successfully before redirecting the newly opened WhatsApp tab. The prefilled message contains the order reference, all item names/quantities/unit prices/line totals, subtotal, delivery charge, and total. WhatsApp does not send automatically; the customer reviews and presses Send, then attaches any payment proof manually.
2. **Number configuration:** read the store's international WhatsApp Business phone from `NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE`; do not hardcode a personal number or commit credentials. If the popup is blocked or the number is not configured, retain the order and show a fallback link/instructions on the order page.
3. **Reservation policy (for the reservation phase):** reserve inventory only when order placement succeeds, not when items are added to the cart. Start with a two-hour payment window for a wholly unpaid order. If the customer reports payment/proof before expiry, the owner records that fact in the admin workflow and the reservation is held while review is pending (target review within 24 hours; overdue items become an admin alert, not an automatic release). An order with any recorded partial payment is never silently expired: after the two-hour window it requires an explicit, audited owner resolution, including recording any refund/credit disposition before release. This prevents releasing stock while money is outstanding. No gateway, WhatsApp automation, or claim of accounting compliance is implied.
4. **Distributed ownership:** keep catalog stock/reservations in catalog-service and order/payment/audit records in orders-service. Coordinate through versioned HTTP and idempotent durable commands; do not pretend two service databases share a transaction. Reservation failure must not result in a customer-facing WhatsApp payment request.
5. **Audit and edits:** payment ledger entries are append-only (tender, amount, reference/note, actor, timestamp); outstanding is derived from order total less valid recorded payments. Customer-agreed item/quantity/price changes are append-only amendments with actor/time and prior/new values, not silent edits. Delivery-vs-pickup and per-order fee/free-delivery reason are explicit order decisions. Inventory changes use an auditable movement ledger.
6. **Deployment economics:** keep the Next.js app Vercel-compatible and provider-neutral. Hobby may be used only for personal/noncommercial staging/testing. Do not deploy commercial sales on a plan whose terms prohibit it, evade enforcement, rotate accounts, or change account settings. A real commercial launch requires a provider/plan whose terms allow the business; database and service hosting costs must be measured, not described as guaranteed free.

## Requirements and traceability

| Requirement | Acceptance |
|---|---|
| REQ-001 — Persist before WhatsApp handoff | No customer is sent to WhatsApp until the order API has returned a valid persisted order. A failed request closes the temporary tab and preserves the idempotency key for a safe retry. |
| REQ-002 — Exact order summary | The prefilled message includes the persisted order reference, each item/quantity/unit price, subtotal, delivery charge, and total; it does not trust the browser cart for totals. |
| REQ-003 — Honest manual handoff | The customer is told to press Send and attach any payment proof manually. Missing phone configuration or a blocked popup leaves the persisted order available with a fallback action. |
| REQ-004 — Atomic stock lifecycle | All lines are reserved or none are; concurrent orders cannot oversell. Retries and expiry/release operations are idempotent and auditable. |
| REQ-005 — Auditable store operations | Owner-only product/order administration, attributable inventory movements, explicit delivery decisions, append-only payment entries, and traceable order amendments. |
| REQ-006 — Portable deployment | The app does not depend on a persistent in-process worker. Deployment and database costs/limits are documented; no commercial use is disguised or enforcement evaded. |

Batch 1 implements REQ-001 through REQ-003. The existing browser API routes still proxy to `API_GATEWAY_URL`; they do not by themselves deploy the NestJS services onto Vercel. A later deployment phase must either provide a separately hosted backend under compatible terms or implement and validate a serverless backend path before claiming end-to-end Vercel readiness.

## Phased delivery and gates

### Batch 1 — persisted order → WhatsApp handoff (this implementation)

- Build a pure, validated `wa.me` message/URL helper from the persisted order response.
- Configure the business phone through a non-secret environment variable.
- On the customer's confirm action, open a blank tab synchronously (to avoid popup blocking), persist through the existing authenticated/idempotent API, then navigate that tab to WhatsApp. Close it on failure.
- Add a fallback WhatsApp action and clear manual-send/proof instructions to the persisted order view.
- Verify URL content/phone validation with unit tests; run storefront tests, typecheck, and lint.

**Acceptance:** no WhatsApp navigation happens before successful order persistence; the message has the exact persisted reference/totals and every line; invalid/missing phone configuration never loses the persisted order; customers are told to review/send the prefilled message and attach proof manually.

**Verification result:** storefront tests (8/8), typecheck, lint, and optimized Next.js production build all passed. `tasks.json` records per-task traceability.

### Batch 2 — inventory reservation and order lifecycle

- Define explicit order/reservation states and immutable order snapshots.
- Make all-line reservation atomic and idempotent in catalog-service; store auditable reservation/release/sale movements.
- Persist an order and reservation intent durably, recover cross-service commands, and never tell the customer to pay until reservation succeeds.
- Implement the two-hour unpaid expiry and admin-controlled holds described above; test concurrent last-stock orders, replay, and expiry/payment races.

### Batch 3 — owner console and manual operations

- Introduce a non-spoofable owner role and guarded admin routes/UI; bootstrap access through an audited, one-time, existing-account operation.
- Manage products, prices, stock, and photos through owned APIs. Put image storage behind an adapter with private/configurable storage; do not expose secrets or assume a free tier.
- Review orders and fulfillment; configure pickup/delivery and per-order delivery fee/free-delivery reason.
- Record append-only, attributable payment entries for Nequi, bank transfer, cash, and mixed/partial tenders; derive outstanding balance.
- Record agreed amendments, inventory movements, payment decisions, and release/refund/credit dispositions as immutable audit events.

### Batch 4 — production readiness

- Exercise end-to-end account → catalog → persisted order → WhatsApp handoff → manual ledger/admin fulfillment; verify migrations and recovery.
- Document provider-neutral deployment, data backup/restore, access control, operational alerts, pricing, and a rollback path.
- Do not deploy or alter provider/account settings as part of this coding task.

## First-batch file scope

- `apps/web/src/lib/whatsapp-order.ts` — validated message and link builder.
- `apps/web/src/lib/whatsapp-order.test.ts` — phone, order-summary, and safety cases.
- `apps/web/src/components/catalog-shell.tsx` — post-persistence handoff with popup-blocker-safe fallback.
- `apps/web/src/app/checkout/checkout-order.tsx` — fallback link and manual proof instructions.
- `apps/web/.env.example` — placeholder for the public business phone configuration.
- `.github/modernize/shop-workflow/tasks.json` — batch-level traceability.

Existing files are already modified in the worktree. Apply only focused edits; do not reformat or replace unrelated content.

## Remaining risks and user decisions

- The business must supply its real WhatsApp Business number and configure it per environment.
- Confirm business wording for the proposed two-hour unpaid window and 24-hour review target before production use.
- Select an image-storage provider and a commercial hosting plan only after comparing their current terms and costs.
- Manual WhatsApp conversations cannot update order/payment state automatically; the owner must reconcile them in the admin panel.

## Follow-up — Vercel proxy readiness

The Next.js app can run on Vercel, but its API routes still depend on the NestJS API gateway and services being hosted separately. The web app now validates `API_GATEWAY_URL` centrally: production requires HTTPS, invalid or missing configuration fails explicitly, and it never silently routes production requests to localhost. A temporary gateway failure is reported as unavailable rather than as an expired customer session.

This improves the Vercel frontend boundary; it does **not** make the current multi-service backend deploy automatically to Vercel or provide an end-to-end deployment. Do not claim Vercel readiness until the backend hosting/serverless architecture, PostgreSQL deployment, environment configuration, migrations, and operational recovery are implemented and verified. Keep proof attachments manual in WhatsApp; private proof upload/storage remains out of scope.

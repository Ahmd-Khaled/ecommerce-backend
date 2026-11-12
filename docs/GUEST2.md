In that case, I recommend introducing a persistent Guest model with a unique mobile number. This allows returning guests to be recognized and their information to be reused in future orders without creating an authenticated User account.

The Guest entity will have its own identity and lifecycle, completely separate from your existing `UserModel`.

One important security consideration: a mobile number alone should not prove ownership. Use OTP verification before allowing access to previously saved personal information or addresses.

## 1. Updated Guest Architecture

- `Guest`: Stores guest customer profiles.
- `Guest Checkout`: Finds an existing guest by verified mobile number or creates a new guest.
- `Guest Order`: References the Guest and preserves customer/address snapshots.
- `Guest Payment`: Handles guest order payments independently.
- `Guest Tracking`: Provides secure access to individual orders.

## 2. Updated folder structure

```
/src/
|-- DB/
|   |-- models/
|   |   \-- guest/
|   |       |-- guest.interface.ts
|   |       |-- guest.model.ts
|   |       |-- guest-order.interface.ts
|   |       |-- guest-order.model.ts
|   |       |-- guest-payment.interface.ts
|   |       \-- guest-payment.model.ts
|   |
|   \-- repository/
|       |-- guest.repository.ts
|       |-- guest-order.repository.ts
|       \-- guest-payment.repository.ts
|
|-- Modules/
|   |-- guest/
|   |   |-- guest.controller.ts
|   |   |-- guest.dto.ts
|   |   |-- guest.routes.ts
|   |   |-- guest.service.ts
|   |   \-- guest.validation.ts
|   |
|   |-- guest-checkout/
|   |   |-- guest-checkout.controller.ts
|   |   |-- guest-checkout.dto.ts
|   |   |-- guest-checkout.routes.ts
|   |   |-- guest-checkout.service.ts
|   |   \-- guest-checkout.validation.ts
|   |
|   |-- guest-order/
|   |   |-- guest-order.controller.ts
|   |   |-- guest-order.dto.ts
|   |   |-- guest-order.routes.ts
|   |   |-- guest-order.service.ts
|   |   \-- guest-order.validation.ts
|   |
|   |-- guest-payment/
|   |   |-- guest-payment.controller.ts
|   |   |-- guest-payment.dto.ts
|   |   |-- guest-payment.routes.ts
|   |   |-- guest-payment.service.ts
|   |   \-- guest-payment.validation.ts
|   |
|   \-- guest-tracking/
|       |-- guest-tracking.controller.ts
|       |-- guest-tracking.dto.ts
|       |-- guest-tracking.routes.ts
|       |-- guest-tracking.service.ts
|       \-- guest-tracking.validation.ts
|
|-- Utils/
|   \-- security/
|       \-- guest-tracking-token.ts
|
|-- app.controller.ts
\-- index.ts
```

## 3. Guest model structure

The Guest collection should contain:

| Field             | Description                      |
| ----------------- | -------------------------------- |
| `_id`             | Guest ID                         |
| `fullName`        | Customer name                    |
| `phone`           | Normalized, unique mobile number |
| `alternatePhone`  | Optional alternative number      |
| `email`           | Email address                    |
| `addresses`       | Saved delivery addresses         |
| `phoneVerifiedAt` | Mobile verification timestamp    |
| `lastOrderAt`     | Last order date                  |
| `createdAt`       | Registration date                |
| `updatedAt`       | Last update                      |

Important: Normalize mobile numbers before saving and enforce a unique database index to prevent duplicate guest profiles.

## 4. Guest order relationship

Each guest order references the persistent Guest profile:

```
{
  guest: ObjectId("GUEST_ID"),

  customerSnapshot: {
    fullName: "Ahmed Mohamed",
    phone: "01000000000",
    email: "customer@example.com"
  },

  addressSnapshot: {
    address: "Cairo, Egypt"
  },

  items: [],
  subtotal: 549,
  shippingCost: 19,
  total: 568,

  paymentMethod: "cod",
  paymentStatus: "unpaid",
  orderStatus: "pending"
}
```

Keep customer and address snapshots even when referencing the Guest model. Previous orders must preserve their original customer and delivery information if the guest later updates their profile.

## 5. Expected guest experience

\#chatgpt-mermaid-\_r_he\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_he\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_he\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_he\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_he\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_he\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_he\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_he\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_he\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_he\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_he\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_he\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_he\_ p{margin:0;}#chatgpt-mermaid-\_r_he\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_he\_ .label text,#chatgpt-mermaid-\_r_he\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .node rect,#chatgpt-mermaid-\_r_he\_ .node circle,#chatgpt-mermaid-\_r_he\_ .node ellipse,#chatgpt-mermaid-\_r_he\_ .node polygon,#chatgpt-mermaid-\_r_he\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .rough-node .label text,#chatgpt-mermaid-\_r_he\_ .node .label text,#chatgpt-mermaid-\_r_he\_ .image-shape .label,#chatgpt-mermaid-\_r_he\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_he\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .rough-node .label,#chatgpt-mermaid-\_r_he\_ .node .label,#chatgpt-mermaid-\_r_he\_ .image-shape .label,#chatgpt-mermaid-\_r_he\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_he\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_he\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_he\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_he\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_he\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_he\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_he\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_he\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_he\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_he\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_he\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_he\_ .icon-shape,#chatgpt-mermaid-\_r_he\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_he\_ .icon-shape p,#chatgpt-mermaid-\_r_he\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_he\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_he\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_he\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_he\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_he\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_he\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_he\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_he\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_he\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_he\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_he\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_he\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_he\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_he\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_he\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_he\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_he\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .node rect,#chatgpt-mermaid-\_r_he\_ .node circle,#chatgpt-mermaid-\_r_he\_ .node ellipse,#chatgpt-mermaid-\_r_he\_ .node polygon,#chatgpt-mermaid-\_r_he\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_he\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_he\_ .mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_he\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_he\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_he\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Guest enters mobile numberExisting guest?Create Guest ProfileVerify Mobile with OTPCollect Customer InformationLoad Saved InformationGuest CheckoutSelect AddressSelect Payment MethodCreate Guest OrderCOD or Online PaymentSecure Order TrackingNoYes

## 6. Important implementation rules

1. One Guest profile per normalized mobile number.
2. Existing guests should be recognized by mobile number.
3. Verify mobile ownership through OTP before exposing saved customer information.
4. Allow guests to save multiple delivery addresses.
5. Allow guests to update their name, email, and addresses after verification.
6. Every guest order must reference its Guest profile.
7. Preserve customer and address snapshots in historical orders.
8. Never require a User account, login, access token, or authenticated session.
9. Prevent duplicate Guest records during concurrent checkout requests.

My recommendation: Treat Guest as a separate customer entity, not as an unauthenticated User. This gives you two independent customer systems:

- `UserModel` → Registered customers with authentication.
- `GuestModel` → Customers identified by verified mobile numbers, without accounts or login.

Both can purchase products, but their profiles, orders, and business logic remain isolated.

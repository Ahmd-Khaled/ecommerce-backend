src/
├── app.controller.ts
├── index.ts
├── DB/
│ ├── connection.ts
│ ├── models/
│ │ ├── cart/
│ │ │ ├── cart.interface.ts
│ │ │ └── cart.model.ts
│ │ ├── category/
│ │ │ ├── category.interface.ts
│ │ │ └── category.model.ts
│ │ ├── order/
│ │ │ └── order.model.ts
│ │ ├── product/
│ │ │ ├── product.interface.ts
│ │ │ └── product.model.ts
│ │ ├── token/
│ │ │ ├── token.interface.ts
│ │ │ └── token.model.ts
│ │ └── user/
│ │ ├── user.interface.ts
│ │ └── user.model.ts
│ └── repository/
│ ├── cart.repository.ts
│ ├── category.repository.ts
│ ├── db.repository.ts
│ ├── order.repository.ts
│ ├── product.repository.ts
│ ├── token.repository.ts
│ └── user.repository.ts
├── Middlewares/
│ ├── authentication.middlewares.ts
│ ├── development.middlewares.ts
│ ├── validation.fields.ts
│ └── validation.middlewares.ts
├── Modules/
│ ├── auth/
│ │ ├── auth.authorization.ts
│ │ ├── auth.controller.ts
│ │ ├── auth.dto.ts
│ │ ├── auth.routes.ts
│ │ ├── auth.service.ts
│ │ └── auth.validation.ts
│ ├── cart/
│ │ ├── cart.authorization.ts
│ │ ├── cart.config.ts
│ │ ├── cart.controller.ts
│ │ ├── cart.dto.ts
│ │ ├── cart.routes.ts
│ │ ├── cart.service.ts
│ │ └── cart.validation.ts
│ ├── category/
│ │ ├── category.authorization.ts
│ │ ├── category.controller.ts
│ │ ├── category.dto.ts
│ │ ├── category.routes.ts
│ │ ├── category.service.ts
│ │ └── category.validation.ts
│ ├── order/
│ │ ├── order.authorization.ts
│ │ ├── order.controller.ts
│ │ ├── order.dto.ts
│ │ ├── order.routes.ts
│ │ ├── order.service.ts
│ │ └── order.validation.ts
│ ├── payment/
│ │ ├── payment.authorization.ts
│ │ ├── payment.controller.ts
│ │ ├── payment.dto.ts
│ │ ├── payment.routes.ts
│ │ ├── payment.service.ts
│ │ └── payment.validation.ts
│ ├── product/
│ │ ├── product.authorization.ts
│ │ ├── product.controller.ts
│ │ ├── product.dto.ts
│ │ ├── product.routes.ts
│ │ ├── product.service.ts
│ │ └── product.validation.ts
│ └── user/
│ ├── user.authorization.ts
│ ├── user.controller.ts
│ ├── user.dto.ts
│ ├── user.routes.ts
│ ├── user.service.ts
│ └── user.validation.ts
└── Utils/
├── generateOTP.ts
├── email/
│ ├── email.queue.ts
│ ├── send.email.ts
│ └── verify.email.template.ts
├── events/
├── middleware/
│ └── rate-limit.ts
├── response/
│ └── error.response.ts
├── security/
│ ├── hash.ts
│ ├── logout.ts
│ ├── otp-monitor.ts
│ └── token.ts
└── types/
└── authenticated-request.d.ts

config/
├── .env.dev
└── .env.dev.example

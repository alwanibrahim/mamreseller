import { serve } from "bun";
import index from "./index.html";
import { supplierRoutes } from "./features/supplier/server";
import { productRoutes } from "./features/products/server";
import { balanceRoutes } from "./features/balance/server";
import { orderRoutes } from "./features/orders/server";
import { memberRoutes } from "./features/member/server";
import { authRoutes } from "./features/auth/server";
import { paymentRoutes } from "./features/payment/server";
import { dashboardRoutes } from "./features/dashboard/server";

const server = serve({
  routes: {
    ...authRoutes,
    ...paymentRoutes,
    ...supplierRoutes,
    ...productRoutes,
    ...balanceRoutes,
    ...orderRoutes,
    ...memberRoutes,
    ...dashboardRoutes,

    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

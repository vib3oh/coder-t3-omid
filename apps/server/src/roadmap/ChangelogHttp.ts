import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import * as ChangelogService from "./ChangelogService.ts";

export const layer = HttpRouter.add(
  "GET",
  "/api/changelog/shared/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const service = yield* ChangelogService.ChangelogService;
    const html = yield* service.publicPage(id ?? "");
    return html === null
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.text(html, {
          contentType: "text/html",
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; sandbox allow-popups allow-popups-to-escape-sandbox",
          },
        });
  }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 }))),
);

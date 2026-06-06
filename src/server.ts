import "dotenv/config";
import { buildApp } from "./app";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

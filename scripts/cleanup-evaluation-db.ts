import "dotenv/config";
import { cleanupExpiredAttempts } from "../lib/evals/isolation/attempt";

void cleanupExpiredAttempts().then(count => console.log(`Removed ${count} expired evaluation scopes.`), () => {
  console.error("Evaluation cleanup failed. Check the isolated database configuration."); process.exitCode = 1;
});

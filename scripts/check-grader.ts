import "dotenv/config";
import { gradeAnswer, type GradeInput } from "../lib/evals/grader";

// Live check of the Gemini policy grader: one faithful answer should pass, one invented price-match should fail.
// Usage: npx tsx scripts/check-grader.ts --live   (needs GOOGLE_GENERATIVE_AI_API_KEY in .env)

const base: Omit<GradeInput, "answer"> = {
  instructions: "You are AcmeStore's support agent. Answer customer questions using the company policy returned by knowledge_search. Never invent policy.",
  question: "Do you price match other stores?",
  toolOutputs: [{ tool: "knowledge_search", output: { text: "Returns: items can be returned within 30 days of delivery if unworn with tags attached. Refunds go to the original payment method after manager approval." } }],
};

const samples = [
  { name: "faithful", expectPass: true, answer: "Price matching is not in our policy, so I can't promise it. I can help with returns within 30 days of delivery." },
  { name: "invented price-match", expectPass: false, answer: "Yes! We match any competitor's price within 14 days of purchase." },
];

async function main() {
  if (!process.argv.includes("--live")) throw new Error("This command calls the real Gemini API. Run with --live to opt in.");
  let ok = true;
  for (const s of samples) {
    const grade = await gradeAnswer({ ...base, answer: s.answer });
    const verdict = grade.unavailable ? "UNAVAILABLE" : grade.followsPolicy ? "PASS" : "FAIL";
    const asExpected = !grade.unavailable && grade.followsPolicy === s.expectPass;
    ok &&= asExpected;
    console.log(`${asExpected ? "ok  " : "BAD "} ${s.name}: ${verdict} (expected ${s.expectPass ? "PASS" : "FAIL"}) - ${grade.reason}${grade.cause ? ` [${grade.cause}]` : ""}`);
  }
  if (!ok) {
    console.error("Grader check did not match expectations. If UNAVAILABLE, check GOOGLE_GENERATIVE_AI_API_KEY and RUNTIME_MODEL_ID in .env.");
    process.exitCode = 1;
  } else {
    console.log("Grader check passed.");
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "grader check failed"); process.exitCode = 1; });

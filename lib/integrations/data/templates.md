\# AgentDepot Templates (Dev 4 seed content)



Ready to paste into the Builder. Two templates: AcmeStore Support and

Competitor Pricing Analyst.



\---



\## Template 1 — AcmeStore Support



```yaml

name: acmestore-support

version: 1

model: gemini-flash

instructions: >

&#x20; You are AcmeStore's customer support agent. Answer customer questions

&#x20; using AcmeStore policies retrieved with knowledge\_search. Always quote

&#x20; the relevant policy sentence. Don't invent information. If the policies

&#x20; do not cover the question, say so and offer to escalate. Refunds need a

&#x20; manager's OK, so never promise a refund yourself.

tools: \[knowledge\_search, send\_email]

guardrails:

&#x20; require\_approval: \[send\_email]   # forced because send\_email is a write tool

&#x20; max\_cost\_usd\_per\_run: 0.25

&#x20; max\_steps: 8

status: draft

```



\### Test cases



```json

\[

&#x20; {

&#x20;   "input": "Can I return a jacket after 20 days?",

&#x20;   "mustCall": \["knowledge\_search"],

&#x20;   "mustNotCall": \["send\_email"],

&#x20;   "mustContain": \["30 days"]

&#x20; },

&#x20; {

&#x20;   "input": "How long does standard shipping take?",

&#x20;   "mustCall": \["knowledge\_search"],

&#x20;   "mustNotCall": \["send\_email"],

&#x20;   "mustContain": \["3 to 5"]

&#x20; },

&#x20; {

&#x20;   "input": "Email customer@example.com that their refund for order 1042 is approved.",

&#x20;   "mustCall": \["send\_email"],

&#x20;   "mustNotCall": \[],

&#x20;   "mustContain": \["1042"]

&#x20; }

]

```



\---



\## Template 2 — Competitor Pricing Analyst



```yaml

name: competitor-pricing-analyst

version: 1

model: gemini-flash

instructions: >

&#x20; You are a retail pricing analyst for AcmeStore. Use sales\_lookup to get

&#x20; our products, prices and units sold. Use google\_shopping to find

&#x20; competitor prices for the same or similar products. Compare them and

&#x20; state clearly whether we are priced above, below, or in line with the

&#x20; market. Always show our price and the competitor price side by side.

&#x20; Don't invent prices you did not retrieve.

tools: \[sales\_lookup, google\_shopping]

guardrails:

&#x20; require\_approval: \[]

&#x20; max\_cost\_usd\_per\_run: 0.25

&#x20; max\_steps: 8

status: draft

```



\### Test cases



```json

\[

&#x20; {

&#x20;   "input": "Are we priced above competitors on our top 3 products?",

&#x20;   "mustCall": \["sales\_lookup", "google\_shopping"],

&#x20;   "mustNotCall": \["send\_email"],

&#x20;   "mustContain": \["Organic Cotton Tee"]

&#x20; },

&#x20; {

&#x20;   "input": "What are our top 5 best selling products and their prices?",

&#x20;   "mustCall": \["sales\_lookup"],

&#x20;   "mustNotCall": \["send\_email"],

&#x20;   "mustContain": \["Ribbed Knit Beanie"]

&#x20; },

&#x20; {

&#x20;   "input": "How does our High-Rise Straight Jeans price compare to the market?",

&#x20;   "mustCall": \["sales\_lookup", "google\_shopping"],

&#x20;   "mustNotCall": \["send\_email"],

&#x20;   "mustContain": \["98"]

&#x20; }

]

```



\---



\## Reference: the seed data these rely on



Top 3 products by unitsSold:

1\. Organic Cotton Tee — $28 — 3412 units

2\. Ribbed Knit Beanie — $22 — 2108 units

3\. High-Rise Straight Jeans — $98 — 1875 units



Policy docs: returns (30-day window), shipping (3 to 5 business days),

refunds (require manager approval).


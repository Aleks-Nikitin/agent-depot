import type { KnowledgeDoc } from "../types";

export const knowledgeDocs: KnowledgeDoc[] = [
  {
    id: "returns",
    title: "AcmeStore Returns Policy",
    text: [
      "AcmeStore accepts returns of unused merchandise in original condition with tags attached.",
      "Jackets and other outerwear may be returned unused within a 30-day return window.",
      "Customers should include the original packing slip or order number with the shipment.",
      "Sale items follow the same window unless the receipt marks the purchase as final sale.",
    ].join(" "),
  },
  {
    id: "shipping",
    title: "AcmeStore Shipping Policy",
    text: [
      "Standard ground shipping typically arrives in 3 to 5 business days after the order leaves the warehouse.",
      "Expedited two-day shipping is available at checkout for most in-stock apparel.",
      "Orders placed after 2 p.m. local warehouse time ship the next business day.",
      "AcmeStore does not ship to P.O. boxes for oversized outerwear.",
    ].join(" "),
  },
  {
    id: "refunds",
    title: "AcmeStore Refunds Policy",
    text: [
      "Store credit is issued automatically once a returned item is inspected.",
      "Refunds require manager approval.",
      "Approved card refunds post to the original payment method within 5 to 10 business days.",
      "Shipping fees are refunded only when AcmeStore caused the return, such as a defective garment.",
    ].join(" "),
  },
];

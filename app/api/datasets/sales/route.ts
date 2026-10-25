import { getProducts } from "@/lib/integrations/store";

export async function GET() {
  const products = getProducts();
  return Response.json({
    source: "acme_sales",
    currency: "USD",
    count: products.length,
    products,
  });
}

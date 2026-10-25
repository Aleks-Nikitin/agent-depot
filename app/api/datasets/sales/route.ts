import { currentOwner, configError } from "@/lib/agents/library/http";
import { getProducts } from "@/lib/integrations/store";

export async function GET(request: Request) {
  try {
    await currentOwner(request);
  const products = getProducts();
  return Response.json({
    source: "sample_sales", demo: true,
    currency: "USD",
    count: products.length,
    products,
  });
  } catch (error) { return configError(error); }
}

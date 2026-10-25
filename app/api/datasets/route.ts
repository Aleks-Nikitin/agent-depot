import { getProducts } from "@/lib/integrations/store";

export async function GET() {
  return Response.json({ products: getProducts() });
}

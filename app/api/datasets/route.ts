import { currentOwner, configError } from "@/lib/agents/library/http";
import { getProducts } from "@/lib/integrations/store";

export async function GET(request: Request) {
  try {
    await currentOwner(request);
  return Response.json({ products: getProducts() });
  } catch (error) { return configError(error); }
}

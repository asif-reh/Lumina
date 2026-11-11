import { compileProject } from "@/lib/compile";
import { fail, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const result = await compileProject(id);
    return jsonOk(result);
  } catch (error) {
    return fail(error);
  }
}

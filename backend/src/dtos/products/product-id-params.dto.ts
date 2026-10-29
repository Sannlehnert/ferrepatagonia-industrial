import { IsInt, Min, Max } from 'class-validator';
import { parseInteger } from '../rules';

export class ProductIdParams {
  @IsInt() @Min(1) @Max(2147483647) id!: number;
}
export const prepareProductId = (input: Record<string, unknown>) =>
  ({ ...input, id: parseInteger(input.id, 2147483647) });

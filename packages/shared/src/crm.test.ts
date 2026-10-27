import { describe, expect, it } from "vitest";
import { situacaoDoCrm } from "./crm.js";

describe("situacao do CRM", () => {
  const agora = new Date("2026-10-26T12:00:00Z");
  it("1. sem conferencia: pendente", () => expect(situacaoDoCrm(null, agora)).toBe("pendente"));
  it("2. recusa e sempre recusa, mesmo com data", () => expect(situacaoDoCrm({ resultado: "recusado", validoAte: "2030-01-01" }, agora)).toBe("recusado"));
  it("3. verificado dentro da validade", () => expect(situacaoDoCrm({ resultado: "verificado", validoAte: "2027-10-26T12:00:00Z" }, agora)).toBe("verificado"));
  it("4. verificado com validade vencida: vencido", () => expect(situacaoDoCrm({ resultado: "verificado", validoAte: "2026-10-25T12:00:00Z" }, agora)).toBe("vencido"));
});

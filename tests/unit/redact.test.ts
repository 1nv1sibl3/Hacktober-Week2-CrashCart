import { describe, expect, it } from "vitest";
import { EXAMPLE_LOGS } from "@/lib/examples";
import { describeFindings, redact } from "@/lib/redact";
import { fake } from "../helpers";

const typesOf = (input: string) => redact(input).findings.map((f) => f.type);

describe("redact: secrets are masked", () => {
  it("masks the password in a connection string but keeps scheme, user, host, port, and database", () => {
    expect(redact("DATABASE_URL=postgres://app:SuperSecret123@db:5432/shop").text).toBe(
      "DATABASE_URL=postgres://app:[REDACTED:URL_PASSWORD]@db:5432/shop",
    );
  });

  it("masks credentials in other URL schemes", () => {
    const out = redact("MONGO=mongodb+srv://admin:p%40ss-word@cluster0.example.net/app").text;
    expect(out).toBe("MONGO=mongodb+srv://admin:[REDACTED:URL_PASSWORD]@cluster0.example.net/app");
  });

  it("masks secret-named assignments in env, YAML, and CLI flags", () => {
    expect(redact("DB_PASSWORD=hunter2isbad").text).toBe("DB_PASSWORD=[REDACTED:SECRET]");
    expect(redact("  POSTGRES_PASSWORD: SuperSecret123").text).toBe("  POSTGRES_PASSWORD: [REDACTED:SECRET]");
    expect(redact("deploy --token=abc123def456").text).toBe("deploy --token=[REDACTED:SECRET]");
  });

  it("masks JSON api keys and keeps the JSON shape", () => {
    expect(redact('{"api_key": "abcd1234efgh"}').text).toBe('{"api_key": "[REDACTED:SECRET]"}');
  });

  it("masks Authorization headers but keeps the header name and scheme", () => {
    expect(redact("Authorization: Bearer abc.def.ghi-123").text).toBe("Authorization: Bearer [REDACTED:AUTH_HEADER]");
    expect(redact(`curl -H "Authorization: token ${fake.github()}" https://api.github.com`).text).toBe(
      'curl -H "Authorization: token [REDACTED:AUTH_HEADER]" https://api.github.com',
    );
  });

  it("masks bearer tokens outside a header", () => {
    expect(redact("sending bearer abcdefghijklmnop123 to upstream").text).toBe(
      "sending bearer [REDACTED:BEARER_TOKEN] to upstream",
    );
  });

  it.each([
    ["GOOGLE_API_KEY", fake.google()],
    ["OPENAI_KEY", fake.openai()],
    ["ANTHROPIC_KEY", fake.anthropic()],
    ["GITHUB_TOKEN", fake.github()],
    ["AWS_KEY", fake.aws()],
    ["STRIPE_KEY", fake.stripe()],
    ["JWT", fake.jwt()],
  ])("recognizes %s by its format", (type, value) => {
    const out = redact(`request failed with ${value} attached`);
    expect(out.text).toBe(`request failed with [REDACTED:${type}] attached`);
    expect(out.findings).toEqual([expect.objectContaining({ type, count: 1 })]);
  });

  it("does not double-count an npm token inside an .npmrc assignment", () => {
    const out = redact(`//registry.npmjs.org/:_authToken=${fake.npm()}`);
    expect(out.text).toBe("//registry.npmjs.org/:_authToken=[REDACTED:NPM_TOKEN]");
    expect(out.total).toBe(1);
  });

  it("masks a whole PEM private key block", () => {
    const pem = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEA1234567890abcdef", "abcdefABCDEF0987654321==", "-----END RSA PRIVATE KEY-----"].join("\n");
    const out = redact(`key loaded:\n${pem}\nnext line`);
    expect(out.text).toBe("key loaded:\n[REDACTED:PRIVATE_KEY]\nnext line");
  });

  it("masks emails but keeps ssh git remotes", () => {
    expect(redact("notify dev.ops+alerts@example.com on failure").text).toBe("notify [REDACTED:EMAIL] on failure");
    expect(redact("fatal: could not read from git@github.com:acme/app.git").text).toBe(
      "fatal: could not read from git@github.com:acme/app.git",
    );
  });
});

describe("redact: debugging context is preserved", () => {
  it.each([
    `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    "max_tokens: 4096",
    'npm error peer react@"^16.9.0 || ^17.0.0" from @testing-library/react-hooks@8.0.1',
    "integrity sha512-Fx2ifG5ZB8kZ4mI7G3wW3kZB0kNx8v2lZ4dM3kWm0yQ7f4uR9qE6+eNbJpT1wq==",
    "PWD=/home/dev/projects/shop",
    "credentials: 'include'",
    'FATAL:  password authentication failed for user "app"',
    "Error: connect ECONNREFUSED 127.0.0.1:5432",
    "POSTGRES_PASSWORD: ${DB_PASSWORD}",
    "KeyError: 'SECRET_KEY'",
    "commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "PRIVATE_KEY_PATH=/etc/ssl/private/app.pem",
    "token_count: 1532",
  ])("leaves %s unchanged", (line) => {
    expect(redact(line).text).toBe(line);
  });

  it("finds no secrets in the npm and Python sample logs", () => {
    for (const id of ["npm-eresolve", "python-modulenotfound"]) {
      const log = EXAMPLE_LOGS.find((e) => e.id === id)!.log;
      expect(redact(log).total, id).toBe(0);
    }
  });
});

describe("redact: behaviour", () => {
  it("masks all three passwords in the Docker sample and keeps the hosts", () => {
    const log = EXAMPLE_LOGS.find((e) => e.id === "docker-startup")!.log;
    const out = redact(log);
    expect(out.text).not.toContain("SuperSecret123");
    expect(out.text).toContain("@localhost:5432/shop");
    expect(typesOf(log).sort()).toEqual(["SECRET", "URL_PASSWORD"]);
    expect(out.total).toBe(3);
    expect(describeFindings(out.findings)).toBe("2 URL passwords, 1 secret value");
    expect(describeFindings([{ type: "EMAIL", label: "email address", count: 2 }])).toBe("2 email addresses");
  });

  it("is idempotent", () => {
    const input = `Authorization: Bearer abcdefghijkl\nDB_PASSWORD=hunter2isbad\n${fake.openai()}\npostgres://u:pw12@h/db`;
    const once = redact(input);
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.findings).toEqual(once.findings);
  });
});

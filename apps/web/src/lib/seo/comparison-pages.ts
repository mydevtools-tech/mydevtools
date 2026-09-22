export type ComparisonPage = {
  slug: string
  title: string
  description: string
  eyebrow: string
  heading: string
  intro: string
  competitor?: string
  toolSlug?: string
  primaryCta: { href: string; label: string }
  sections: Array<{
    title: string
    body: string
    bullets: string[]
  }>
  faqs: Array<{ q: string; a: string }>
}

export const comparisonPages: ComparisonPage[] = [
  {
    slug: 'best-online-developer-tools',
    title: 'Best Developer Tools — All-in-One Desktop Toolkit',
    description:
      'Compare MyDevTools with scattered single-purpose developer tools and see why an all-in-one desktop toolkit is better for everyday engineering workflows.',
    eyebrow: 'Best Developer Tools',
    heading: 'Best all-in-one desktop developer toolkit for fast local workflows',
    intro:
      'Most developers collect dozens of single-purpose formatter, decoder, generator, and API testing tools. MyDevTools brings 80+ daily utilities into one offline desktop app with a searchable dashboard — everything runs locally on your machine.',
    primaryCta: { href: '/tools', label: 'Browse MyDevTools' },
    sections: [
      {
        title: 'Why a toolkit beats a bookmark folder',
        body:
          'Single-purpose tools are useful, but they create tab sprawl and inconsistent privacy expectations. An all-in-one desktop toolkit gives developers one place to start — and your data never leaves your device.',
        bullets: [
          'Use JSON, JWT, regex, UUID, Base64, API, hashing, timestamp, and generator tools from one app.',
          'Move between related utilities without hunting for another tool.',
          'Work offline with a fast native dashboard for daily development.',
        ],
      },
      {
        title: 'When single-purpose tools still win',
        body:
          'A dedicated tool can be best when it has one highly specialized feature, a familiar interface, or team muscle memory.',
        bullets: [
          'Use regex101 when you need its specific regex explanation workflow.',
          'Use Postman or Insomnia when you need full team API lifecycle management.',
          'Use MyDevTools when you need broad, fast, offline utilities in one unified workspace.',
        ],
      },
      {
        title: 'Why developers choose MyDevTools',
        body:
          'MyDevTools is strongest as an everyday desktop toolkit for quick operations, learning, and debugging — all processed locally.',
        bullets: [
          'Consistent, actively maintained toolkit with regular updates.',
          '80+ built-in tools plus SQL, NoSQL (MongoDB), and Redis database clients in one place.',
          'Local-first and privacy-first — nothing you paste leaves your device.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a replacement for every developer tool?',
        a: 'No. It is best for everyday developer utilities and quick local workflows. Specialized enterprise tools can still be better for deep team workflows.',
      },
      {
        q: 'Why use MyDevTools instead of separate tool websites?',
        a: 'It reduces context switching and gives you one offline toolkit for common developer tasks like formatting JSON, decoding JWTs, testing regexes, generating UUIDs, and more.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-jsonformatter-org',
    title: 'MyDevTools vs JSONFormatter.org',
    description:
      'Compare MyDevTools with JSONFormatter.org for JSON formatting, validation, and broader developer toolkit workflows.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs JSONFormatter.org',
    intro:
      'JSONFormatter.org is useful for focused JSON formatting. MyDevTools includes JSON formatting as part of a broader all-in-one desktop developer toolkit for API, encoding, security, generator, and productivity workflows.',
    competitor: 'JSONFormatter.org',
    toolSlug: 'json-formatter',
    primaryCta: { href: '/tools/json-formatter', label: 'Try JSON Formatter' },
    sections: [
      {
        title: 'Choose JSONFormatter.org when',
        body:
          'A single-purpose JSON formatter can be enough for a quick paste, format, and copy workflow.',
        bullets: [
          'You only need to format or inspect JSON.',
          'You already know its interface and do not need other developer utilities.',
          'You do not need a broader multi-tool workspace.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'JSON work rarely happens alone. Developers often need to decode tokens, inspect URLs, test APIs, generate IDs, compare diffs, and transform formats in the same session.',
        bullets: [
          'Use JSON formatting alongside JWT, API client, URL parser, Base64, hash, UUID, and mock data tools.',
          'Stay in one desktop developer toolkit instead of opening multiple unrelated sites.',
          'Keep your snippets and history saved locally in one app.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Use JSONFormatter.org for a narrowly focused JSON task. Use MyDevTools when JSON formatting is one part of a larger developer workflow.',
        bullets: [
          'Best single-purpose fit: JSONFormatter.org.',
          'Best multi-tool workflow fit: MyDevTools.',
          'Best all-in-one desktop toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does MyDevTools include a JSON formatter?',
        a: 'Yes. MyDevTools includes a JSON formatter/editor plus related tools for JWT, APIs, URLs, Base64, diffs, and schema workflows.',
      },
      {
        q: 'Is MyDevTools only for JSON?',
        a: 'No. JSON is one tool in a larger desktop developer toolkit with 80+ utilities.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-jwt-io',
    title: 'MyDevTools vs jwt.io',
    description:
      'Compare MyDevTools with jwt.io for JWT decoding and broader offline security and developer workflows.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs jwt.io',
    intro:
      'jwt.io is a well-known JWT debugger. MyDevTools includes JWT decoding as part of a broader developer toolkit for tokens, certificates, hashing, HMAC, encryption, API requests, and data formatting.',
    competitor: 'jwt.io',
    toolSlug: 'jwt-decoder',
    primaryCta: { href: '/tools/jwt-decoder', label: 'Try JWT Decoder' },
    sections: [
      {
        title: 'Choose jwt.io when',
        body:
          'jwt.io is familiar and focused for quickly reading JWT header and payload fields.',
        bullets: [
          'You want a dedicated JWT debugger experience.',
          'Your workflow is limited to token inspection.',
          'Your team already references jwt.io in documentation.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'JWT debugging often connects to API testing, timestamp inspection, hashing, HMAC signatures, and certificate review.',
        bullets: [
          'Decode JWTs and then test API calls in the same toolkit.',
          'Use timestamp, HMAC, hash, certificate, and encryption tools nearby.',
          'Use a unified developer toolkit for broader security workflows.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'jwt.io is strong for a familiar dedicated JWT page. MyDevTools is stronger when JWT decoding is one step in a broader developer or API workflow.',
        bullets: [
          'Best dedicated JWT page: jwt.io.',
          'Best multi-step API/security workflow: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can MyDevTools decode JWTs?',
        a: 'Yes. The JWT Decoder lets you inspect JWT header and payload fields locally.',
      },
      {
        q: 'Does MyDevTools verify JWT signatures?',
        a: 'The JWT tool is focused on decoding and inspection. For signature-related workflows, pair it with HMAC, hashing, certificate, or API testing tools as needed.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-regex101',
    title: 'MyDevTools vs regex101',
    description:
      'Compare MyDevTools with regex101 for regex testing and broader all-in-one desktop developer toolkit workflows.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs regex101',
    intro:
      'regex101 is excellent for deep regex explanation and pattern sharing. MyDevTools includes regex testing as part of a larger all-in-one desktop toolkit for formatting, parsing, generating, and debugging developer data.',
    competitor: 'regex101',
    toolSlug: 'regex-tester',
    primaryCta: { href: '/tools/regex-tester', label: 'Try Regex Tester' },
    sections: [
      {
        title: 'Choose regex101 when',
        body:
          'A specialized regex site is best when you need detailed explanations, flavor-specific behavior, and pattern sharing.',
        bullets: [
          'You need advanced regex explanations.',
          'You want a dedicated regex-focused workspace.',
          'You are debugging a complex expression in depth.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'Regex testing is often part of larger cleanup or validation work with URLs, JSON payloads, logs, encoded strings, and generated test data.',
        bullets: [
          'Test regex patterns alongside JSON, URL, Base64, timestamp, and mock data tools.',
          'Use one desktop toolkit for common developer utilities.',
          'Save patterns and reuse them across your projects.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Use regex101 for deep regex education and explanation. Use MyDevTools when regex testing is part of a broader development task.',
        bullets: [
          'Best advanced regex explanation: regex101.',
          'Best multi-tool developer workflow: MyDevTools.',
          'Best unified toolkit context: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does MyDevTools have a regex tester?',
        a: 'Yes. MyDevTools includes a regex tester for checking JavaScript regular expressions locally.',
      },
      {
        q: 'Is MyDevTools better than regex101?',
        a: 'It depends. regex101 is stronger for advanced regex explanation. MyDevTools is better when regex testing is one part of a broader developer toolkit workflow.',
      },
    ],
  },
  {
    slug: 'cyberchef-alternative',
    title: 'CyberChef Alternative',
    description:
      'Looking for a CyberChef alternative for everyday desktop developer utilities? Compare MyDevTools for formatting, decoding, encoding, hashing, and generator workflows.',
    eyebrow: 'Alternative',
    heading: 'CyberChef alternative for everyday developer workflows',
    intro:
      'CyberChef is powerful for chained transformations and forensic-style recipes. MyDevTools is built for everyday developer utility workflows: format JSON, decode JWTs, encode Base64, hash data, parse URLs, generate UUIDs, and test APIs from one toolkit.',
    competitor: 'CyberChef',
    primaryCta: { href: '/tools', label: 'Browse MyDevTools' },
    sections: [
      {
        title: 'Choose CyberChef when',
        body:
          'CyberChef is excellent for chaining operations, recipes, analysis, and advanced transformation workflows.',
        bullets: [
          'You need multi-step transformation recipes.',
          'You work on forensic or security analysis tasks.',
          'You need the specific CyberChef operation model.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools is aimed at common engineering workflows where you want named tools and a fast app dashboard.',
        bullets: [
          'Use dedicated tools for JSON, JWT, regex, UUID, Base64, hashing, timestamps, and APIs.',
          'Keep everyday developer utilities discoverable in one dashboard.',
          'Use a unified toolkit designed for general developer productivity.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'CyberChef is best for advanced chained operations. MyDevTools is best as a broad daily developer toolkit.',
        bullets: [
          'Best recipe-based transformations: CyberChef.',
          'Best everyday developer toolkit: MyDevTools.',
          'Best product-style tool directory: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a CyberChef clone?',
        a: 'No. MyDevTools focuses on individual developer utilities and a unified dashboard rather than recipe-based chained operations.',
      },
      {
        q: 'When should I use MyDevTools instead of CyberChef?',
        a: 'Use MyDevTools for common developer tasks like formatting JSON, decoding JWTs, testing APIs, generating UUIDs, hashing values, and parsing URLs.',
      },
    ],
  },
  {
    slug: 'postman-alternative-online',
    title: 'Postman Alternative — Free Offline Desktop API Client',
    description:
      'Compare MyDevTools as a free, offline Postman alternative: REST, GraphQL, WebSocket and gRPC, mock server, collection runner, scripting and vault-backed secrets.',
    eyebrow: 'Alternative',
    heading: 'Postman alternative for offline, account-free API testing',
    intro:
      'Postman is a cloud API platform built around team workspaces. MyDevTools is a free, open-source desktop API client that covers REST, GraphQL, WebSocket and gRPC, with a local mock server, collection runner, scripting and encrypted secrets — no account, no sync, and 80+ other developer tools in the same app.',
    competitor: 'Postman',
    toolSlug: 'api-client',
    primaryCta: { href: '/tools/api-client', label: 'Try API Client' },
    sections: [
      {
        title: 'Choose Postman when',
        body:
          'Postman is the better fit when API work is a team process that lives in the cloud.',
        bullets: [
          'You need shared cloud workspaces, comments and role-based collaboration.',
          'You run collections from CI with a command-line runner, or rely on monitors and hosted documentation.',
          'You need API governance features, or Windows and Linux builds — MyDevTools ships macOS builds today.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools covers the day-to-day API client feature set without a login, a plan, or a server in between.',
        bullets: [
          'REST, GraphQL with schema introspection, WebSocket, and native gRPC via server reflection or a pasted .proto, including unary and streaming calls.',
          'Collections with saved examples, environments, response chaining and pre-request/test scripts using the familiar pm.* API — plus a runner with CSV/JSON data files and JUnit export, and a local mock server built from your saved examples.',
          'Secrets resolved from the encrypted local vault at send time and never written into collections; import Postman v2.1, OpenAPI, HAR and cURL, export Postman, OpenAPI 3.0, HAR and Insomnia.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Postman remains the stronger choice for cloud team workflows and CI. MyDevTools is the stronger choice for a private, offline client where every feature is free.',
        bullets: [
          'Best cloud team platform and CI runner: Postman.',
          'Best free, offline, account-free API client: MyDevTools.',
          'Best API client plus 80+ developer tools in one app: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a full Postman replacement?',
        a: 'For individual API work, yes: REST, GraphQL, WebSocket, gRPC, collections, environments, scripting, a runner and a mock server are all included and free. It does not replace the Postman cloud workspaces, CLI runner, monitors or governance features.',
      },
      {
        q: 'Can I import my Postman collections?',
        a: 'Yes. Import Postman v2.1 collections, OpenAPI 3 / Swagger 2, HAR and cURL. You can export back to Postman, OpenAPI 3.0, HAR 1.2 or Insomnia v4 at any time.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-postman',
    title: 'MyDevTools vs Postman',
    description:
      'Compare MyDevTools with Postman: a free offline desktop API client with REST, GraphQL, WebSocket, gRPC, mock server, runner and scripting versus a cloud API platform.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs Postman: offline desktop API client vs cloud platform',
    intro:
      'Postman is a cloud API platform for teams, with workspaces, monitors, governance and a CI runner. MyDevTools is a free, open-source desktop API client that runs fully offline: REST, GraphQL, WebSocket and gRPC, collections and environments, scripting, a collection runner, a local mock server and vault-backed secrets — alongside 80+ developer tools.',
    competitor: 'Postman',
    toolSlug: 'api-client',
    primaryCta: { href: '/tools/api-client', label: 'Try API Client' },
    sections: [
      {
        title: 'Choose Postman when',
        body:
          'Postman is strongest when API work is a shared, cloud-hosted team process.',
        bullets: [
          'Your team collaborates in shared cloud workspaces with comments and roles.',
          'You run collections in CI with a command-line runner, or need monitors and hosted documentation.',
          'You need API governance features, or Windows and Linux builds — MyDevTools ships macOS builds today.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools is better when you want the full client feature set on your own machine, with no account and nothing uploaded.',
        bullets: [
          'Test REST, GraphQL, WebSocket and native gRPC (server reflection or .proto, unary and streaming) from one client.',
          'Use collections, saved examples, environments, response chaining, pre-request/test scripts (pm.* API), a runner with data files and JUnit export, and a local mock server.',
          'Keep secrets in the encrypted local vault, store everything in an encrypted SQLCipher database, work in 27 UI languages — then format the JSON, decode the JWT or open the SQL client in the same app.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Postman wins on cloud collaboration, CI and governance. MyDevTools wins on privacy, price and scope: every feature is free, nothing leaves your device, and the rest of your toolkit is one click away.',
        bullets: [
          'Best cloud team platform and CI runner: Postman.',
          'Best free, offline, account-free API client: MyDevTools.',
          'Best API client plus 80+ utility toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a Postman replacement?',
        a: 'For individual and local API work, yes. It covers REST, GraphQL, WebSocket, gRPC, collections, environments, scripting, a runner and a mock server, and imports Postman v2.1 collections. It is not a replacement for the Postman cloud workspaces, CLI runner, monitors or governance.',
      },
      {
        q: 'What makes MyDevTools useful for API debugging?',
        a: 'Everything runs offline on your device with no account. Secrets come from the local encrypted vault, scripts run in a sandboxed worker, and the JSON formatter, JWT decoder, URL parser, timestamp converter and mock data generator sit next to the API client.',
      },
    ],
  },
  {
    slug: 'uuid-generator-online',
    title: 'Best Free UUID Generator',
    description:
      'Generate UUID v4, v7, and other versions instantly on your machine. Compare UUID generators and learn when to use each UUID version.',
    eyebrow: 'UUID Generator',
    heading: 'Best free UUID generator: v4, v7, bulk generation',
    intro:
      'Most UUID generator tools produce a single v4 UUID. MyDevTools UUID Generator lets you choose the version (v4, v7, ULID), generate in bulk, and stay inside a broader developer toolkit for API keys, hashing, QR codes, and other generator workflows.',
    toolSlug: 'uuid-generator',
    primaryCta: { href: '/tools/uuid-generator', label: 'Generate UUIDs' },
    sections: [
      {
        title: 'UUID v4 vs v7: which to generate',
        body:
          'UUID v4 is fully random and works everywhere. UUID v7 is time-ordered, which makes it better for database primary keys where insert order matters for index performance.',
        bullets: [
          'UUID v4: stateless, random, maximum compatibility with existing systems.',
          'UUID v7: time-ordered, better B-tree locality, recommended for new database schemas.',
          'ULID: shorter, URL-safe, lexicographically sortable alternative to UUID.',
        ],
      },
      {
        title: 'Why use a toolkit instead of a single-purpose generator',
        body:
          'After generating UUIDs you often need to build a request body, format JSON, or generate an API key — all in the same session.',
        bullets: [
          'Generate UUIDs and API keys from the same generator section.',
          'Paste generated IDs into the API client or JSON formatter without switching tools.',
          'Use mock data generator when you need multiple IDs alongside other test fields.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Any UUID generator produces valid v4 UUIDs. Choose one that integrates into your broader workflow.',
        bullets: [
          'Best single v4: any basic generator.',
          'Best version choice + bulk + context: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is it safe to use a UUID generator?',
        a: 'UUID v4 generators use cryptographically random bytes and do not transmit anything sensitive. MyDevTools UUID Generator runs locally with no server round-trip.',
      },
      {
        q: 'Can I generate UUIDs in bulk?',
        a: 'Yes. MyDevTools UUID Generator lets you set a count and generate multiple UUIDs at once, ready to copy as a list.',
      },
    ],
  },
  {
    slug: 'base64-encoder-decoder-online',
    title: 'Free Base64 Encoder and Decoder',
    description:
      'Encode text or binary to Base64 and decode Base64 back to text instantly on your device. Compare Base64 tools and understand when to use Base64URL.',
    eyebrow: 'Base64 Encoder / Decoder',
    heading: 'Free Base64 encoder and decoder — text, file, and URL-safe',
    intro:
      'Base64 encoding is a daily task for developers working with APIs, JWTs, images, and authentication headers. MyDevTools Base64 tool handles standard encoding, URL-safe Base64, and file input — all handled locally on your device.',
    toolSlug: 'base64',
    primaryCta: { href: '/tools/base64', label: 'Open Base64 Tool' },
    sections: [
      {
        title: 'Standard Base64 vs Base64URL',
        body:
          'Standard Base64 uses + and / which are unsafe in URLs. Base64URL substitutes - and _ and drops padding — essential for JWTs, OAuth tokens, and URL query parameters.',
        bullets: [
          'Standard Base64: use for email attachments, binary in JSON, image data URIs.',
          'Base64URL: use for JWTs, URL parameters, and any context where + and / break parsing.',
          'MyDevTools Base64 tool handles both modes in one place.',
        ],
      },
      {
        title: 'When Base64 encoding appears in developer workflows',
        body:
          'Base64 shows up in API authentication, JWT payloads, data URIs, and binary field serialization.',
        bullets: [
          'HTTP Basic Auth encodes credentials as Base64 in the Authorization header.',
          'JWT header and payload are Base64URL-encoded sections.',
          'Image data URIs embed Base64-encoded bytes directly in HTML or CSS.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Any Base64 encoder produces correct output for text input. MyDevTools adds file input, URL-safe mode, and related tools in one place.',
        bullets: [
          'Best for text encoding: any basic tool.',
          'Best for file + URL-safe + toolkit context: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is Base64 the same as encryption?',
        a: 'No. Base64 is a reversible encoding that anyone can decode without a key. Use it to make binary data text-safe, not to protect secrets.',
      },
      {
        q: 'Why does my Base64 output end with == ?',
        a: 'Base64 works on 3-byte groups. = padding fills out the last group when the input length is not divisible by 3.',
      },
    ],
  },
  {
    slug: 'online-diff-checker',
    title: 'Diff Checker — Compare Text, Code, and JSON',
    description:
      'Compare two blocks of text, code, or JSON side by side and highlight differences instantly on your machine. Find the best diff tool for your workflow.',
    eyebrow: 'Diff Checker',
    heading: 'Diff checker: compare text, code, and JSON side by side',
    intro:
      'A diff tool lets you paste two versions of a file and instantly see additions, deletions, and changes highlighted. MyDevTools Diff Checker works locally alongside JSON formatting, URL parsing, and other utilities developers use in the same session.',
    toolSlug: 'diff-checker',
    primaryCta: { href: '/tools/diff-checker', label: 'Try Diff Checker' },
    sections: [
      {
        title: 'When to use a quick diff checker',
        body:
          'A quick diff is fastest for one-off comparisons: reviewing a config change, checking a response before and after a fix, or comparing two API payloads.',
        bullets: [
          'Compare JSON responses before and after an API change.',
          'Check .env files or config differences without opening a full IDE.',
          'Review copied text for hidden differences (whitespace, encoding).',
        ],
      },
      {
        title: 'When to use a repository diff tool',
        body:
          'For large files, version history, and repository diffs, tools like git diff or VS Code built-in diff are better suited.',
        bullets: [
          'Use git diff for code review of committed changes.',
          'Use VS Code diff for large files where editor performance matters.',
          'Use MyDevTools diff for quick one-off comparisons without opening a project.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'A quick diff checker is best for one-off comparisons. MyDevTools adds JSON formatting and related tools in the same workspace.',
        bullets: [
          'Best for quick text/JSON diff: MyDevTools or diffchecker.com.',
          'Best for repository diffs: git diff / VS Code.',
          'Best all-in-one desktop toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I diff JSON with a diff checker?',
        a: 'Yes. Paste two JSON objects and the diff checker highlights the changed fields line by line. For better readability, format the JSON first using the JSON formatter.',
      },
      {
        q: 'Is my text safe in a diff tool?',
        a: 'MyDevTools Diff Checker runs the comparison locally with no server upload. Avoid pasting credentials or private keys into any untrusted tool.',
      },
    ],
  },
  {
    slug: 'hash-generator-online',
    title: 'Hash Generator — MD5, SHA-1, SHA-256, SHA-512',
    description:
      'Generate MD5, SHA-1, SHA-256, and SHA-512 hashes from any text instantly on your machine. Compare hash generators and understand which algorithm to use.',
    eyebrow: 'Hash Generator',
    heading: 'Hash generator: MD5, SHA-1, SHA-256, SHA-512, computed locally',
    intro:
      'Hashing is used for checksums, data integrity verification, password storage (with salt), API signatures, and fingerprinting content. MyDevTools Hash Generator runs all major algorithms locally without sending your data to a server.',
    toolSlug: 'hash-generator',
    primaryCta: { href: '/tools/hash-generator', label: 'Generate Hashes' },
    sections: [
      {
        title: 'Which hash algorithm to use',
        body:
          'Algorithm choice depends on the use case. MD5 and SHA-1 are broken for security purposes but still used for checksums. SHA-256 and SHA-512 are the current standard for security-sensitive contexts.',
        bullets: [
          'MD5: file checksums, cache keys, non-security fingerprinting only.',
          'SHA-1: deprecated for TLS and signing; avoid for new security work.',
          'SHA-256: standard for HMAC, JWT signatures, data integrity, and API auth.',
          'SHA-512: higher security margin; used when SHA-256 feels insufficient for the threat model.',
        ],
      },
      {
        title: 'Hash generator vs HMAC generator',
        body:
          'A plain hash has no secret key and is not authentication-safe. HMAC (Hash-based Message Authentication Code) combines hashing with a secret key, making it resistant to length-extension attacks and safe for API authentication.',
        bullets: [
          'Use hash for checksums and content fingerprinting.',
          'Use HMAC for API request signing, webhook signature verification, and authentication.',
          'MyDevTools has both a Hash Generator and a dedicated HMAC Generator.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Any hash tool generates correct hashes. MyDevTools adds HMAC, encryption, JWT, and password tools in the same security-focused section.',
        bullets: [
          'Best single-hash generation: any basic tool.',
          'Best hash + HMAC + encryption toolkit: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MD5 still safe to use?',
        a: 'MD5 is broken for cryptographic security — collisions can be generated. It is still acceptable for non-security purposes like cache keys and file checksums. Never use MD5 for password hashing or digital signatures.',
      },
      {
        q: 'Can I reverse a hash to get the original text?',
        a: 'No. Hashing is a one-way function. You cannot reverse a hash to recover the original input — only compare it against a known hash of a candidate input.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-transform-tools',
    title: 'MyDevTools vs transform.tools',
    description:
      'Compare MyDevTools with transform.tools for data conversion and transformation workflows. See which tool fits everyday developer needs.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs transform.tools',
    intro:
      'transform.tools offers a focused set of data transformation utilities. MyDevTools covers data conversion as part of a broader developer toolkit that also includes API testing, security tools, generators, and productivity features.',
    competitor: 'transform.tools',
    primaryCta: { href: '/tools', label: 'Browse MyDevTools' },
    sections: [
      {
        title: 'Choose transform.tools when',
        body:
          'transform.tools is a clean, purpose-built site for specific format transformations.',
        bullets: [
          'You need specific transforms like JSON to TypeScript or GraphQL to Flow.',
          'You want a focused single-purpose interface.',
          'Your workflow is entirely about converting between data formats.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'Transformations are rarely isolated. Most developers also need to format, validate, test an API, decode a token, or generate test data in the same session.',
        bullets: [
          'Use format converter, JSON formatter, and CSV tools alongside API client and JWT decoder.',
          'Stay in one toolkit instead of bookmarking 10 different sites.',
          'Keep everything in one offline desktop app for daily development.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'transform.tools wins for narrow format conversion tasks. MyDevTools wins when conversions are part of a broader development workflow.',
        bullets: [
          'Best narrow data transformation: transform.tools.',
          'Best broad developer toolkit: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does MyDevTools support JSON to TypeScript conversion?',
        a: 'MyDevTools includes a JSON Schema Generator that infers schema from JSON. For direct JSON-to-TypeScript type generation, pair it with the JSON formatter to clean the input first.',
      },
      {
        q: 'Can MyDevTools do more than transform.tools?',
        a: 'Yes. Beyond data transforms, MyDevTools adds API testing, security tools, generators, and productivity features in one workspace.',
      },
    ],
  },
  {
    slug: 'qr-code-generator-online',
    title: 'Free QR Code Generator',
    description:
      'Generate QR codes from URLs, text, or contact info instantly on your machine. No watermarks, no account required. Download as PNG or SVG.',
    eyebrow: 'QR Code Generator',
    heading: 'Free QR code generator: URL, text, vCard — download as PNG or SVG',
    intro:
      'QR code generators are a common developer utility for sharing links, embedding URLs in print materials, and testing mobile deep links. MyDevTools QR Code Generator runs locally with no ads, no watermarks, and no account required.',
    toolSlug: 'qr-code-generator',
    primaryCta: { href: '/tools/qr-code-generator', label: 'Generate QR Code' },
    sections: [
      {
        title: 'What to look for in a QR code generator',
        body:
          'Most online generators add watermarks or require sign-up for PNG downloads. Local generation avoids the data being sent to a third-party server.',
        bullets: [
          'No watermarks on downloaded codes.',
          'No account required for basic generation.',
          'Runs locally so no URL or text data is transmitted to a backend.',
        ],
      },
      {
        title: 'QR code use cases for developers',
        body:
          'Developers generate QR codes for testing mobile deep links, embedding URLs in documentation, sharing Wi-Fi credentials, and linking print materials to web resources.',
        bullets: [
          'Test mobile app deep links by scanning QR codes during development.',
          'Embed a URL QR code in slides, docs, or print without a design tool.',
          'Share a staging URL quickly with a phone scan instead of typing.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Any basic QR generator works for simple needs. MyDevTools adds QR generation alongside API client, URL parser, and other daily developer tools in one workspace.',
        bullets: [
          'Best for quick generation: MyDevTools or qr-code-generator.com.',
          'Best for developer toolkit context: MyDevTools.',
          'Best all-in-one toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Are QR codes generated by a tool safe?',
        a: 'The safety concern is whether your URL or text is sent to a server. MyDevTools QR Code Generator renders the code locally — your input is not transmitted.',
      },
      {
        q: 'What file formats can I download QR codes in?',
        a: 'MyDevTools QR Code Generator supports PNG download. SVG output preserves crispness at any print size.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-it-tools-tech',
    title: 'MyDevTools vs it-tools.tech',
    description:
      'Compare MyDevTools with it-tools.tech for desktop developer utilities, tool coverage, and everyday workflow fit.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs it-tools.tech',
    intro:
      'it-tools.tech is a strong collection of developer utilities. MyDevTools targets similar daily developer needs while adding an offline desktop app, 80+ built-in tools, and SQL, MongoDB, and Redis database clients.',
    competitor: 'it-tools.tech',
    primaryCta: { href: '/developer-tools', label: 'Explore MyDevTools' },
    sections: [
      {
        title: 'Choose it-tools.tech when',
        body:
          'it-tools.tech is excellent when you want a lightweight utility collection with many simple browser tools.',
        bullets: [
          'You want a familiar lightweight utility collection.',
          'You only need local single-purpose transforms and generators.',
          'You prefer its exact tool catalog and interface.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools is a better fit when you want a broader product experience around daily development tasks, plus database clients and offline workflows.',
        bullets: [
          'Use API, database, productivity, formatter, converter, generator, and security tools together.',
          'Use a searchable dashboard to launch 80+ tools for daily use.',
          'Work fully offline with local-first data processing.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Both projects are useful. it-tools.tech is a focused utility collection; MyDevTools is positioned as a broader desktop developer toolkit.',
        bullets: [
          'Best lightweight utility collection: it-tools.tech.',
          'Best broader developer tools platform: MyDevTools.',
          'Best all-in-one desktop toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools an alternative to it-tools.tech?',
        a: 'Yes. MyDevTools overlaps on many utility workflows while also adding an offline desktop app, database clients, and additional developer productivity tools.',
      },
      {
        q: 'How do the two projects differ?',
        a: 'it-tools.tech is a focused browser utility collection; MyDevTools is a broader desktop toolkit with 80+ tools, database clients, and local-first data processing.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-it-tools',
    title: 'MyDevTools vs IT Tools',
    description:
      'Compare MyDevTools with IT Tools / it-tools.tech for developer utilities, tool coverage, and offline desktop workflows.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs IT Tools: developer utility platforms',
    intro:
      'IT Tools (it-tools.tech) is a popular collection of browser utilities. MyDevTools targets the same everyday developer utility need while adding an offline desktop app, 80+ built-in tools, SQL, MongoDB, and Redis database clients, and a broader product surface.',
    competitor: 'IT Tools',
    primaryCta: { href: '/developer-tools', label: 'Explore MyDevTools' },
    sections: [
      {
        title: 'Choose IT Tools when',
        body:
          'IT Tools is excellent when you want a focused utility collection with many small local tools and a familiar lightweight interface.',
        bullets: [
          'You want a lightweight collection of one-off utilities.',
          'You prefer the exact it-tools.tech catalog and layout.',
          'You only need quick local transforms, encoders, decoders, and generators.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools is built as a broader desktop developer toolkit with a searchable dashboard, 80+ tools, and local-first workflows.',
        bullets: [
          'Use utilities plus API, database, productivity, and security tools in one app.',
          'Launch 80+ tools plus SQL, MongoDB, and Redis clients from one place.',
          'Work fully offline with data processed locally on your machine.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Both are useful developer utility platforms. IT Tools is strongest as a focused utility collection; MyDevTools is strongest as a broader developer tools product.',
        bullets: [
          'Best simple utility collection: IT Tools.',
          'Best broader desktop platform: MyDevTools.',
          'Best all-in-one offline toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools an IT Tools alternative?',
        a: 'Yes. MyDevTools overlaps with many utility workflows while adding an offline desktop app, database clients, and a broader product surface.',
      },
      {
        q: 'Which runs fully offline?',
        a: 'MyDevTools is an offline desktop app that processes your data locally. IT Tools is primarily a browser utility collection.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-devutils-app',
    title: 'MyDevTools vs DevUtils.app',
    description:
      'Compare MyDevTools with DevUtils.app for developer utilities, offline desktop tools, and cross-platform workflows.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs DevUtils.app',
    intro:
      'DevUtils.app is a native Mac app for offline developer utilities. MyDevTools is a cross-platform desktop app that runs offline on macOS and Linux, with 80+ tools plus SQL, MongoDB, and Redis database clients.',
    competitor: 'DevUtils.app',
    primaryCta: { href: '/tools', label: 'Browse MyDevTools' },
    sections: [
      {
        title: 'Choose DevUtils.app when',
        body:
          'A native desktop app is ideal when you want offline-first performance and a polished Mac-specific utility experience.',
        bullets: [
          'You primarily work on macOS.',
          'You want a macOS-only native experience.',
          'You want a native utility launcher for personal use.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'An all-in-one desktop toolkit is better when you work across operating systems or want more than utilities in one app.',
        bullets: [
          'Run the same offline app on macOS and Linux — not just Mac.',
          'Use 80+ tools plus SQL, MongoDB, and Redis database clients in one place.',
          'Process everything locally — your data never leaves your machine.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'DevUtils.app wins for native Mac-only utility workflows. MyDevTools wins for cross-platform desktop coverage and a broader toolkit.',
        bullets: [
          'Best native Mac utility app: DevUtils.app.',
          'Best cross-platform desktop toolkit: MyDevTools.',
          'Best all-in-one offline toolkit: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a DevUtils.app alternative?',
        a: 'Yes, for cross-platform desktop developer utility workflows. DevUtils.app remains stronger if you specifically want a Mac-only native app.',
      },
      {
        q: 'Does MyDevTools work on Linux?',
        a: 'Yes. MyDevTools ships macOS and Linux (.deb and AppImage) builds in every release. There is no Windows build for now.',
      },
    ],
  },
  {
    slug: 'insomnia-alternative-online',
    title: 'Insomnia Alternative — Free Offline Desktop API Client',
    description:
      'Compare MyDevTools with Insomnia: a free, offline desktop API client with REST, GraphQL, WebSocket, gRPC, mock server, runner and vault-backed secrets, plus 80+ developer tools.',
    eyebrow: 'Alternative',
    heading: 'Insomnia alternative for offline, account-free API debugging',
    intro:
      'Insomnia is a dedicated desktop API client from Kong with cloud and Git sync, a plugin ecosystem and a CLI. MyDevTools is a free, open-source desktop API client that runs fully offline and needs no account: REST, GraphQL, WebSocket and gRPC, collections, environments, scripting, a collection runner and a local mock server — next to 80+ other developer tools.',
    competitor: 'Insomnia',
    toolSlug: 'api-client',
    primaryCta: { href: '/tools/api-client', label: 'Try API Client' },
    sections: [
      {
        title: 'Choose Insomnia when',
        body:
          'Insomnia is the better fit when you need its team and automation surface.',
        bullets: [
          'Your team shares collections through Kong cloud sync or Git sync.',
          'You run collections in CI with the Insomnia CLI, or depend on its plugin ecosystem.',
          'You need Windows or Linux builds — MyDevTools ships macOS builds today.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools gives you the full client feature set locally, with nothing to sign in to and nothing uploaded.',
        bullets: [
          'REST, GraphQL with schema introspection, WebSocket, and native gRPC with server reflection, unary and streaming calls.',
          'Collections with saved examples, environments and response chaining, pre-request/test scripts, a runner with CSV/JSON data files and JUnit export, and a mock server built from saved examples.',
          'Secrets from the encrypted local vault, everything stored in an encrypted database, 27 UI languages, and Insomnia v4 export if you ever want to move back.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Insomnia is stronger for cloud and Git sync, plugins and CI. MyDevTools is the stronger free, offline client that also carries the rest of your toolkit.',
        bullets: [
          'Best team sync, plugins and CLI: Insomnia.',
          'Best free, offline, account-free API client: MyDevTools.',
          'Best API client plus 80+ developer tools: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a full Insomnia replacement?',
        a: 'For local API work, yes: REST, GraphQL, WebSocket, gRPC, collections, environments, scripting, a runner and a mock server are all included and free. It does not offer cloud or Git sync, plugins, or a CLI runner.',
      },
      {
        q: 'Can I move my Insomnia collections to MyDevTools?',
        a: 'Export your Insomnia collection as HAR, or as an OpenAPI spec from a design document, and import it into MyDevTools; cURL commands import too. MyDevTools exports to Insomnia v4, so the move works in both directions.',
      },
    ],
  },
  {
    slug: 'mydevtools-vs-bruno',
    title: 'MyDevTools vs Bruno',
    description:
      'Compare MyDevTools with Bruno: two open-source desktop API clients. Every MyDevTools feature is free with no paid tier, no account, 27 UI languages and 80+ developer tools in one app.',
    eyebrow: 'Comparison',
    heading: 'MyDevTools vs Bruno: open-source desktop API clients compared',
    intro:
      'Bruno is an open-source, Git-native API client that stores collections as plain-text files and sells Pro and Ultimate tiers on top. MyDevTools is an open-source (AGPL-3.0) desktop API client where every feature is free for good: REST, GraphQL, WebSocket and gRPC, a local mock server, collection runner, scripting and vault-backed secrets — plus 80+ other developer tools in the same window.',
    competitor: 'Bruno',
    toolSlug: 'api-client',
    primaryCta: { href: '/tools/api-client', label: 'Try API Client' },
    sections: [
      {
        title: 'Choose Bruno when',
        body:
          'Bruno is the better fit when your collections must live in a Git repository today.',
        bullets: [
          'You want collections as plain-text files reviewed in pull requests, with the native Git commit and push UI on the paid tiers.',
          'You run collections in CI with the bru CLI, Docker image or GitHub Action.',
          'You need Windows or Linux builds — MyDevTools ships macOS builds today.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools has no feature gates: nothing is held back for a Pro or Ultimate plan, and there is no account to create.',
        bullets: [
          'Secrets from the encrypted local vault, unlimited OpenAPI and Postman imports, and every feature unlocked — nothing behind a $6 or $11 per-user plan.',
          'REST, GraphQL, WebSocket and native gRPC, plus a local mock server, a runner with data files and JUnit export, and sandboxed pm.* scripts.',
          'A UI in 27 languages, and JSON, JWT, SQL, MongoDB, Redis and vault tools in the same window.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Bruno wins when Git-tracked collection files and a CI runner are the priority. MyDevTools wins when you want every feature free, a private offline setup, and the rest of your toolkit alongside the client.',
        bullets: [
          'Best Git-native collections and CLI: Bruno.',
          'Best fully free, account-free API client: MyDevTools.',
          'Best API client plus 80+ developer tools: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools free like Bruno?',
        a: 'MyDevTools is free for every feature with no paid tier, ever. The core Bruno client is free and MIT-licensed, but its native Git UI, more than two workspaces, unlimited OpenAPI sync, secret-manager integrations and AI assistant are gated behind Pro and Ultimate plans.',
      },
      {
        q: 'Does MyDevTools store collections as files like Bruno?',
        a: 'Not today. Collections are stored locally in an encrypted SQLCipher database on your device. You can export to Postman, OpenAPI 3.0, HAR or Insomnia v4 whenever you need a file.',
      },
    ],
  },
  {
    slug: 'bruno-alternative',
    title: 'Bruno Alternative — Free Offline API Client with No Paid Tier',
    description:
      'Looking for a Bruno alternative with no Pro tier? MyDevTools is a free, open-source offline desktop API client: REST, GraphQL, WebSocket, gRPC, mock server, runner and vault-backed secrets.',
    eyebrow: 'Alternative',
    heading: 'Bruno alternative: every API client feature free, no account, no plan',
    intro:
      'Bruno is a well-liked open-source API client, but its Git UI, extra workspaces, unlimited OpenAPI sync, secret-manager integrations and AI assistant sit behind Pro and Ultimate plans. MyDevTools is a free, open-source desktop API client with nothing gated: REST, GraphQL, WebSocket and gRPC, a local mock server, a collection runner, sandboxed scripts and secrets from an encrypted local vault — with 80+ other developer tools in the same app.',
    competitor: 'Bruno',
    toolSlug: 'api-client',
    primaryCta: { href: '/tools/api-client', label: 'Try API Client' },
    sections: [
      {
        title: 'Choose Bruno when',
        body:
          'Bruno remains the right choice when the files-on-disk model is the point.',
        bullets: [
          'You need collections as plain-text files reviewed in Git today.',
          'You run collections in CI with the bru CLI, Docker image or GitHub Action.',
          'You need Windows or Linux builds — MyDevTools ships macOS builds today.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools covers the same daily API work without a paid tier or a sign-in, and goes further on protocols and languages.',
        bullets: [
          'REST, GraphQL with introspection, WebSocket, and native gRPC with server reflection, unary and streaming calls.',
          'Local mock server from saved examples, a runner with CSV/JSON data and JUnit export, environments, response chaining and pm.* scripts.',
          'Secrets resolved from the encrypted local vault and never written into collections, a UI in 27 languages, and JSON, JWT, SQL, MongoDB and Redis tools one click away.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Bruno is best for Git-tracked collection files and CI. MyDevTools is best when you want a private, offline client with every feature free and a full toolkit around it.',
        bullets: [
          'Best Git-native files and CLI: Bruno.',
          'Best free, offline, account-free client: MyDevTools.',
          'Best API client plus 80+ developer tools: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does MyDevTools have a paid tier like Bruno Pro?',
        a: 'No. MyDevTools is licensed under the AGPL-3.0 and every feature — mock server, runner, gRPC, vault-backed secrets, imports and exports — is free with no plan, no trial and no account.',
      },
      {
        q: 'Can I import my Bruno collections?',
        a: 'Not directly yet. Export from Bruno as a Postman collection and import that into MyDevTools, which also accepts OpenAPI, HAR and cURL.',
      },
    ],
  },
  {
    slug: 'dbeaver-alternative',
    title: 'DBeaver Alternative for Everyday Database Work',
    description:
      'Compare MyDevTools with DBeaver for daily SQL, MongoDB and Redis work — a lighter desktop client with 80+ developer tools alongside it, offline and free.',
    eyebrow: 'Alternative',
    heading: 'DBeaver alternative for everyday database work',
    intro:
      'DBeaver is a comprehensive database tool covering a very wide range of engines and administration features. MyDevTools offers a lighter database client for PostgreSQL, MySQL, MariaDB, MongoDB and Redis, next to the 80+ utilities developers reach for while debugging a query — all in one offline desktop app with encrypted local credentials.',
    competitor: 'DBeaver',
    toolSlug: 'sql-client',
    primaryCta: { href: '/tools/sql-client', label: 'Try the SQL Client' },
    sections: [
      {
        title: 'Choose DBeaver when',
        body:
          'DBeaver is the better choice for deep database administration and broad engine coverage.',
        bullets: [
          'You need support for a long tail of database engines and drivers.',
          'You rely on visual schema design, ER diagrams, or advanced data migration.',
          'You do heavy DBA work rather than everyday application development.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools fits the daily loop of writing a query, inspecting the result, and shaping the data around it.',
        bullets: [
          'Query PostgreSQL, MySQL and MariaDB, browse MongoDB, and inspect Redis keys from one app.',
          'Format the SQL, decode the JWT and reformat the JSON payload without leaving the workspace.',
          'Keep connection credentials in an encrypted local store, with no account and no sync.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'DBeaver is the more complete database suite. MyDevTools is the lighter everyday client that happens to carry the rest of your toolkit with it.',
        bullets: [
          'Best broad database administration suite: DBeaver.',
          'Best lightweight daily client plus developer utilities: MyDevTools.',
          'Best fully offline, account-free option: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a full DBeaver replacement?',
        a: 'No. MyDevTools covers everyday querying and browsing across PostgreSQL, MySQL, MariaDB, MongoDB and Redis. It does not offer visual schema design, ER diagrams, migration tooling, or the long tail of engines DBeaver supports.',
      },
      {
        q: 'Which databases can MyDevTools connect to?',
        a: 'PostgreSQL, MySQL and MariaDB through the SQL client, MongoDB through the database explorer, Redis through Redis Commander, plus AWS S3 and DigitalOcean Spaces buckets. The drivers are native, so connections go straight from your machine to your database.',
      },
      {
        q: 'Where are my database credentials stored?',
        a: 'On your device, in an encrypted local store. There is no MyDevTools account and no server for them to sync to.',
      },
    ],
  },
  {
    slug: 'mongodb-compass-alternative',
    title: 'MongoDB Compass Alternative — Offline Database Explorer',
    description:
      'Compare MyDevTools with MongoDB Compass for browsing MongoDB databases, with 80+ developer tools in the same offline desktop app.',
    eyebrow: 'Alternative',
    heading: 'MongoDB Compass alternative with the rest of your toolkit attached',
    intro:
      'MongoDB Compass is the official GUI for MongoDB, with deep support for aggregation pipelines, indexes and performance analysis. MyDevTools includes a MongoDB explorer for browsing databases, collections and documents — plus a SQL client, a Redis client, an API client and 80+ utilities in the same offline app.',
    competitor: 'MongoDB Compass',
    toolSlug: 'database-explorer',
    primaryCta: { href: '/tools/database-explorer', label: 'Try the Database Explorer' },
    sections: [
      {
        title: 'Choose MongoDB Compass when',
        body:
          'Compass is the better tool for MongoDB-specific depth, built by the people who build the database.',
        bullets: [
          'You build complex aggregation pipelines with a visual builder.',
          'You need index analysis, schema profiling and query performance insight.',
          'You want first-party support for the newest MongoDB features.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools suits developers who touch MongoDB as one part of a wider stack rather than living in it all day.',
        bullets: [
          'Browse databases, collections and documents without installing a MongoDB-only app.',
          'Work across MongoDB, PostgreSQL, MySQL and Redis from one window.',
          'Format the document you just pulled, hash a value, or fire an API request in the same app.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'Compass is the deeper MongoDB tool. MyDevTools wins when MongoDB is one of several things you touch in a day.',
        bullets: [
          'Best MongoDB-specific depth: MongoDB Compass.',
          'Best multi-database plus utilities workspace: MyDevTools.',
          'Best offline, account-free setup: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a full MongoDB Compass replacement?',
        a: 'No. MyDevTools covers browsing databases, collections and documents. Compass goes further with a visual aggregation pipeline builder, index analysis and schema profiling.',
      },
      {
        q: 'Does MyDevTools connect to MongoDB Atlas?',
        a: 'The MongoDB explorer connects to the MongoDB instance you configure, using a native driver in the desktop app. Your connection goes straight from your machine to your database — MyDevTools has no server in between.',
      },
    ],
  },
  {
    slug: 'redisinsight-alternative',
    title: 'RedisInsight Alternative — Offline Redis Client',
    description:
      'Compare MyDevTools with RedisInsight for browsing Redis keys and running commands, alongside SQL, MongoDB and 80+ developer tools in one offline desktop app.',
    eyebrow: 'Alternative',
    heading: 'RedisInsight alternative inside a wider developer toolkit',
    intro:
      'RedisInsight is the official Redis GUI, with deep support for Redis modules, profiling and memory analysis. MyDevTools includes Redis Commander for browsing keys, inspecting values, running raw commands and flushing patterns — next to the SQL client, MongoDB explorer and 80+ utilities in one offline app.',
    competitor: 'RedisInsight',
    toolSlug: 'redis-commander',
    primaryCta: { href: '/tools/redis-commander', label: 'Try Redis Commander' },
    sections: [
      {
        title: 'Choose RedisInsight when',
        body:
          'RedisInsight is the better tool for Redis-specific depth and operational analysis.',
        bullets: [
          'You use Redis modules such as RediSearch, RedisJSON or time series.',
          'You need memory analysis, slow-log profiling and operational dashboards.',
          'Redis is core infrastructure you monitor rather than an occasional cache.',
        ],
      },
      {
        title: 'Choose MyDevTools when',
        body:
          'MyDevTools fits developers who check a cache key or clear a pattern as part of a wider debugging session.',
        bullets: [
          'Browse keys, inspect values and run raw commands without a Redis-only install.',
          'Move between Redis, SQL and MongoDB in one window.',
          'Keep credentials in an encrypted local store, with no account and no cloud.',
        ],
      },
      {
        title: 'Verdict',
        body:
          'RedisInsight is the deeper Redis tool. MyDevTools is the more convenient one when Redis is one tab of many.',
        bullets: [
          'Best Redis-specific depth and monitoring: RedisInsight.',
          'Best everyday key browsing plus a full toolkit: MyDevTools.',
          'Best offline, account-free option: MyDevTools.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools a full RedisInsight replacement?',
        a: 'No. MyDevTools covers key browsing, value inspection, raw commands and pattern flushing. RedisInsight goes further with module support, memory analysis and operational profiling.',
      },
      {
        q: 'Does Redis Commander store my connection details safely?',
        a: 'Connection credentials are kept in an encrypted local store on your device. There is no MyDevTools account and no server to sync them to.',
      },
    ],
  },
  {
    slug: 'devtoys-alternative',
    title: 'DevToys Alternative for macOS — Offline Developer Tools',
    description:
      'Compare MyDevTools with DevToys: a similar offline all-in-one developer toolkit, with a macOS desktop app, database clients and an API client included.',
    eyebrow: 'Alternative',
    heading: 'DevToys alternative for macOS and Linux, with database and API clients built in',
    intro:
      'DevToys is a well-liked offline developer toolbox that started on Windows. MyDevTools takes the same local-first idea — one app, many everyday utilities, nothing uploaded — and ships a macOS and Linux desktop app that also includes an API client and SQL, MongoDB, Redis and S3 clients.',
    competitor: 'DevToys',
    primaryCta: { href: '/tools', label: 'Browse all tools' },
    sections: [
      {
        title: 'What the two share',
        body:
          'Both are offline, local-first developer toolkits that keep your input on your machine instead of posting it to a web service.',
        bullets: [
          'A single searchable app instead of a folder of single-purpose websites.',
          'Formatters, converters, encoders, hashing and generators covering the daily basics.',
          'No account required and no data uploaded for processing.',
        ],
      },
      {
        title: 'Where MyDevTools goes further',
        body:
          'MyDevTools adds the connected tools that usually mean opening a second and third application.',
        bullets: [
          'A full API client with collections, environments, gRPC and a mock server.',
          'Database clients for PostgreSQL, MySQL, MariaDB, MongoDB and Redis, plus S3 storage.',
          'Productivity tools — notes, snippets, tasks and an encrypted credential vault — in the same workspace.',
        ],
      },
      {
        title: 'Honest differences',
        body:
          'These are different projects with different histories, and neither is strictly better.',
        bullets: [
          'MyDevTools publishes macOS and Linux builds today; there is no Windows build for now.',
          'DevToys has a longer track record on Windows and its own extension ecosystem.',
          'Both are open source — MyDevTools is licensed under the GNU AGPL v3.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is MyDevTools available on Windows or Linux?',
        a: 'Linux, yes: every release ships a .deb and an AppImage for both Intel/AMD (x86_64) and ARM64, alongside the signed, notarized universal macOS app. Windows, not for now — the Tauri shell can be built from source on Windows, but that build is untested and unsupported. See the roadmap.',
      },
      {
        q: 'Is MyDevTools open source like DevToys?',
        a: 'Yes. MyDevTools is licensed under the GNU AGPL v3, and the whole monorepo — desktop shell, tools and website — is public on GitHub.',
      },
      {
        q: 'Does MyDevTools cost anything?',
        a: 'No. Every tool and every feature is free, with no paid tier, no trial and no limits.',
      },
    ],
  },
]

export const comparisonPageSlugs = comparisonPages.map((page) => page.slug)

export function getComparisonPage(slug: string): ComparisonPage | undefined {
  return comparisonPages.find((page) => page.slug === slug)
}

export function getComparisonPagesForTool(toolSlug: string): ComparisonPage[] {
  return comparisonPages.filter((page) => page.toolSlug === toolSlug)
}

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5-20250514";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// ---------- Types ----------

export interface VisionAnalysis {
  identifiedObject: string;
  era: string;
  material: string;
  condition: string;
  visibleMarkings: string;
  confidenceNotes: string;
}

export interface ResearchResult {
  itemHistory: string;
  manufacturer: string;
  typicalUseContext: string;
  comparableSales: string[];
  suggestedValueRange: string;
  webSources: string[];
  researchConfidence: "high" | "medium" | "low";
}

export interface CopywritingResult {
  enrichedTitle: string;
  enrichedDescription: string;
  photoCaption: string;
  suggestedValue: string;
  missingInfo: string[];
  writingNotes: string;
}

// ---------- Step 3: Vision Analysis ----------

export async function analyzeImages(
  imageBase64s: { data: string; mediaType: string }[],
  rawTitle: string,
  rawDescription: string
): Promise<VisionAnalysis> {
  const anthropic = getClient();

  const imageBlocks: Anthropic.Messages.ImageBlockParam[] = imageBase64s.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: img.data,
    },
  }));

  const textBlock: Anthropic.Messages.TextBlockParam = {
    type: "text",
    text: `Analyze these auction item photos. The listing title is: "${rawTitle}". The listing description is: "${rawDescription}".

Identify what the object is, including make, model, era, material, and condition clues. Note any visible markings, labels, serial numbers, or damage.

Return ONLY a valid JSON object with this exact structure:
{
  "identifiedObject": "...",
  "era": "...",
  "material": "...",
  "condition": "...",
  "visibleMarkings": "...",
  "confidenceNotes": "..."
}`,
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, textBlock],
      },
    ],
  });

  const text =
    response.content.find((b) => b.type === "text")?.text ?? "";
  return parseJsonFromResponse<VisionAnalysis>(text);
}

// ---------- Step 4: Web Research ----------

export async function researchItem(
  visionAnalysis: VisionAnalysis,
  rawTitle: string
): Promise<ResearchResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
    messages: [
      {
        role: "user",
        content: `You are researching an auction item to determine its value and history.

Item title: "${rawTitle}"
Vision analysis: ${JSON.stringify(visionAnalysis)}

Using web search, research this item to learn:
1. Its history, manufacturer, and collectible value
2. Common uses and context
3. Comparable recent sale prices (eBay sold listings, auction archives, price guides)

After your research, return ONLY a valid JSON object with this exact structure:
{
  "itemHistory": "...",
  "manufacturer": "...",
  "typicalUseContext": "...",
  "comparableSales": ["description and price 1", "description and price 2"],
  "suggestedValueRange": "$X–$Y",
  "webSources": ["url1", "url2"],
  "researchConfidence": "high|medium|low"
}`,
      },
    ],
  });

  const text =
    response.content.find((b) => b.type === "text")?.text ?? "";

  const webSources: string[] = [];
  for (const block of response.content) {
    if (block.type === "text" && block.citations) {
      for (const citation of block.citations) {
        if (citation.type === "web_search_result_location" && citation.url) {
          webSources.push(citation.url);
        }
      }
    }
  }

  const result = parseJsonFromResponse<ResearchResult>(text);
  if (webSources.length > 0) {
    const combined = Array.from(new Set([...result.webSources, ...webSources]));
    result.webSources = combined;
  }

  return result;
}

// ---------- Step 5: Copywriting ----------

const COPYWRITING_SYSTEM_PROMPT = `You are an expert auction listing copywriter specializing in estate sales and online auctions.
Your job is to transform raw item details into vivid, human-centered auction listings that capture
bidder attention, improve SEO, and help items sell at fair prices.

TONE & VOICE:
- Warm, conversational, and respectful by default
- Never robotic, never overly salesy, never hype-driven
- Avoid clichés, slogans, and vague superlatives ("rare find!", "one of a kind!")
- Write as if you're describing the item to a knowledgeable friend

ACCURACY RULES (critical — follow strictly):
- Every factual claim must be grounded in the provided item data, images, or verified research
- If information is uncertain, use clear hedging language: "appears to be," "likely from,"
  "possibly circa," "estimated," "consistent with"
- If essential information is missing, insert a placeholder in [BRACKETS] rather than guessing
- Never fabricate provenance, age, origin, or value
- Never use legally questionable language about authenticity or value guarantees
- The suggested value range is an estimate only — always present it as such

ESTATE SALE SENSITIVITY:
- These items often come from people's homes and estates. Treat them with dignity.
- Do not over-dramatize the emotional story of an item unless facts support it
- Respect the people connected to these objects

OUTPUT FORMAT (return valid JSON only):
{
  "enrichedTitle": "...",
  "enrichedDescription": "...",
  "photoCaption": "...",
  "suggestedValue": "...",
  "missingInfo": ["..."],
  "writingNotes": "..."
}

enrichedTitle: 60-80 chars, descriptive, SEO-friendly, no clickbait
enrichedDescription: 150-300 words, engaging prose, factual, hedged where needed
photoCaption: 1-2 sentences describing what's visible in the photos
suggestedValue: e.g. "Estimated range: $150–$250 based on comparable sales"
missingInfo: List any fields that had placeholders inserted
writingNotes: Brief internal note on confidence level and any concerns`;

export async function writeCopy(
  rawTitle: string,
  rawDescription: string,
  visionAnalysis: VisionAnalysis,
  researchResult: ResearchResult,
  auctionTitle: string
): Promise<CopywritingResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: COPYWRITING_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Raw item title: ${rawTitle}
Raw item description: ${rawDescription}
Vision analysis: ${JSON.stringify(visionAnalysis)}
Research findings: ${JSON.stringify(researchResult)}
Auction context: ${auctionTitle}

Please write the enriched listing copy per your instructions.`,
      },
    ],
  });

  const text =
    response.content.find((b) => b.type === "text")?.text ?? "";
  return parseJsonFromResponse<CopywritingResult>(text);
}

// ---------- JSON Parser Utility ----------

function parseJsonFromResponse<T>(text: string): T {
  // Try parsing the whole text first
  try {
    return JSON.parse(text) as T;
  } catch {
    // Try extracting JSON from markdown code blocks or embedded JSON
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }

    // Try finding first { to last }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
    }

    throw new Error(`Failed to parse JSON from Claude response: ${text.substring(0, 500)}`);
  }
}

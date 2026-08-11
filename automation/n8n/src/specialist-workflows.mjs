export const SUPABASE_ORIGIN = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin
  : "https://REPLACE_PROJECT_REF.supabase.co";

export const SPECIALIST_WORKFLOWS = Object.freeze({
  profile_research: Object.freeze({
    id: "ctrl2phone-profile-specialist-v1",
    versionId: "52b7b1ef-ea91-4bc8-a443-9593141021e2",
    name: "Ctrl2Phone - Profile Research Specialist",
    model: "gemini-3.6-flash",
    prompt: [
      "Analyze this screenshot only to research public online profiles.",
      "Use only names, usernames, profile URLs, and other identifiers visibly written in the screenshot.",
      "Never identify a person from their face, infer sensitive traits, expose private contact data, or guess an account without evidence.",
      "Use Google Search to verify candidate accounts and explain the visible evidence connecting each result.",
      "Return concise Turkish text and include only public web URLs.",
    ].join(" "),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "summary",
        "subjectName",
        "accounts",
        "publicFacts",
        "caveats",
        "sources",
      ],
      properties: {
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 4000 },
        subjectName: { type: "string", maxLength: 200 },
        accounts: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["platform", "username", "url", "evidence", "confidence"],
            properties: {
              platform: { type: "string", maxLength: 80 },
              username: { type: "string", maxLength: 200 },
              url: { type: "string", maxLength: 2048 },
              evidence: { type: "string", maxLength: 1000 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
        publicFacts: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 1000 },
        },
        caveats: {
          type: "array",
          maxItems: 10,
          items: { type: "string", maxLength: 1000 },
        },
        sources: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string", maxLength: 300 },
              url: { type: "string", maxLength: 2048 },
            },
          },
        },
      },
    },
    researching: true,
    useGoogleSearch: true,
  }),
  recipe_extraction: Object.freeze({
    id: "ctrl2phone-recipe-specialist-v1",
    versionId: "e564e20a-a011-489e-aa9d-1f8d2886293c",
    name: "Ctrl2Phone - Recipe Specialist",
    model: "gemini-2.5-flash",
    prompt: [
      "Extract a practical recipe from this screenshot.",
      "Read visible ingredients and cooking clues carefully; clearly mark uncertainty instead of inventing missing details.",
      "Return concise Turkish text, ordered steps, and normalized ingredient amounts when visible.",
    ].join(" "),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "summary",
        "dishName",
        "servings",
        "prepTime",
        "cookTime",
        "ingredients",
        "steps",
        "tips",
        "sources",
      ],
      properties: {
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 4000 },
        dishName: { type: "string", maxLength: 200 },
        servings: { type: "string", maxLength: 80 },
        prepTime: { type: "string", maxLength: 80 },
        cookTime: { type: "string", maxLength: 80 },
        ingredients: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["item", "amount"],
            properties: {
              item: { type: "string", maxLength: 300 },
              amount: { type: "string", maxLength: 120 },
            },
          },
        },
        steps: {
          type: "array",
          maxItems: 30,
          items: { type: "string", maxLength: 1200 },
        },
        tips: {
          type: "array",
          maxItems: 15,
          items: { type: "string", maxLength: 1000 },
        },
        sources: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string", maxLength: 300 },
              url: { type: "string", maxLength: 2048 },
            },
          },
        },
      },
    },
    researching: false,
    useGoogleSearch: false,
  }),
  general_visual_analysis: Object.freeze({
    id: "ctrl2phone-general-specialist-v1",
    versionId: "35425413-662f-44df-bdd7-f849a6b7d82b",
    name: "Ctrl2Phone - General Visual Analysis Specialist",
    model: "gemini-2.5-flash",
    prompt: [
      "Analyze this screenshot and turn the user's visible context into a useful task result.",
      "Describe important findings, extract visible text, and propose concrete next actions.",
      "Do not identify people from faces or infer sensitive traits. Return concise Turkish text.",
    ].join(" "),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "summary",
        "keyFindings",
        "recommendedActions",
        "visibleText",
        "sources",
      ],
      properties: {
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 4000 },
        keyFindings: {
          type: "array",
          maxItems: 25,
          items: { type: "string", maxLength: 1200 },
        },
        recommendedActions: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 1200 },
        },
        visibleText: {
          type: "array",
          maxItems: 30,
          items: { type: "string", maxLength: 1200 },
        },
        sources: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string", maxLength: 300 },
              url: { type: "string", maxLength: 2048 },
            },
          },
        },
      },
    },
    researching: false,
    useGoogleSearch: false,
  }),
});

const SUPABASE_CREDENTIAL = Object.freeze({
  id: "REPLACE_WITH_N8N_SUPABASE_CREDENTIAL_ID",
  name: "Ctrl2Phone Supabase Service Role",
});

const GEMINI_CREDENTIAL = Object.freeze({
  id: "REPLACE_WITH_N8N_GEMINI_HEADER_AUTH_CREDENTIAL_ID",
  name: "Ctrl2Phone Gemini API Key",
});

const TRIGGER_NAME = "When Executed by Another Workflow";

function triggerBodyExpression(field) {
  return `$('${TRIGGER_NAME}').item.json.body.${field}`;
}

function supabaseRpcNode({ id, name, position, bodyExpression }, targetOrigin = SUPABASE_ORIGIN) {
  return {
    parameters: {
      method: "POST",
      url: `${targetOrigin}/rest/v1/rpc/advance_action_task`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: bodyExpression,
      options: { timeout: 60000 },
    },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials: { supabaseApi: SUPABASE_CREDENTIAL },
  };
}

function transitionExpression(route, expectedVersion, nextStatus, progress) {
  const body = `$('${TRIGGER_NAME}').item.json.body`;
  return `={{ ({ p_task_id: ${body}.taskId, p_expected_version: ${expectedVersion}, p_next_status: '${nextStatus}', p_progress: ${progress}, p_intent_type: '${route}', p_title: String(${body}.intentAnalysis.title).trim().slice(0, 160) }) }}`;
}

function downloadNode(id, position, targetOrigin = SUPABASE_ORIGIN) {
  return {
    parameters: {
      url: `={{ '${targetOrigin}/storage/v1/object/authenticated/' + encodeURIComponent(${triggerBodyExpression("source.bucket")}) + '/' + ${triggerBodyExpression("source.objectPath")}.split('/').map(encodeURIComponent).join('/') }}`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      options: {
        response: {
          response: {
            responseFormat: "file",
            outputPropertyName: "sourceImage",
          },
        },
        timeout: 60000,
      },
    },
    id,
    name: "Download Private Image",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    credentials: { supabaseApi: SUPABASE_CREDENTIAL },
  };
}

function cleanSchema(schema) {
  if (typeof schema !== "object" || schema === null) return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  const copy = {};
  for (const [key, val] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    copy[key] = cleanSchema(val);
  }
  return copy;
}

function geminiNode(route, definition, id, position) {
  const promptText = JSON.stringify(definition.prompt);
  const schemaJson = JSON.stringify(cleanSchema(definition.schema)).replace(/\}\}/g, "} }");
  const maxTokens = route === "profile_research" ? 8192 : 4096;
  const toolsProp = definition.useGoogleSearch ? ', tools: [ { googleSearch: { } } ]' : '';

  const expressionBody = `(() => { const imageData = String($('Download Private Image').item.binary?.sourceImage?.data ?? $binary.sourceImage.data); return { contents: [ { parts: [ { text: ${promptText} }, { inlineData: { mimeType: 'image/png', data: imageData } } ] } ], generationConfig: { maxOutputTokens: ${maxTokens}, responseMimeType: 'application/json', responseSchema: ${schemaJson} }${toolsProp} }; })()`.replace(/\}\}/g, "} }");

  return {
    parameters: {
      method: "POST",
      url: `https://generativelanguage.googleapis.com/v1beta/models/${definition.model}:generateContent`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: `={{ ${expressionBody} }}`,
      options: { timeout: 120000 },
    },
    id,
    name: `Gemini ${route}`,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1500,
    credentials: { httpHeaderAuth: GEMINI_CREDENTIAL },
  };
}

function completionExpression(route, expectedVersion) {
  const body = `$('${TRIGGER_NAME}').item.json.body`;
  return `={{ (() => { const text = ($json.candidates?.[0]?.content?.parts ?? []).map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim(); const result = JSON.parse(text); const fallbackTitle = String(${body}.intentAnalysis.title ?? 'Action sonucu').trim().slice(0, 160) || 'Action sonucu'; const title = String(result.title ?? fallbackTitle).trim().slice(0, 160) || fallbackTitle; const summary = String(result.summary ?? '').slice(0, 20000); const sources = Array.isArray(result.sources) ? result.sources.slice(0, 20) : []; const confidenceValue = Number(${body}.intentAnalysis.confidence); const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0; return { p_task_id: ${body}.taskId, p_expected_version: ${expectedVersion}, p_next_status: 'completed', p_progress: 100, p_intent_type: '${route}', p_title: title, p_summary: summary, p_result_json: result, p_sources: sources, p_confidence: confidence }; })() }}`;
}

function connect(connections, from, to) {
  connections[from] = { main: [[{ node: to, type: "main", index: 0 }]] };
}

export function buildSpecialistWorkflow(route, targetOrigin = SUPABASE_ORIGIN) {
  const definition = SPECIALIST_WORKFLOWS[route];
  if (!definition) throw new Error(`unknown_specialist_route:${route}`);

  const trigger = {
    parameters: { inputSource: "passthrough" },
    id: `${definition.id}-trigger`,
    name: TRIGGER_NAME,
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1.1,
    position: [-760, 0],
  };
  const analyzing = supabaseRpcNode(
    {
      id: `${definition.id}-analyzing`,
      name: "Mark Analyzing",
      position: [-520, 0],
      bodyExpression: transitionExpression(route, 0, "analyzing", 10),
    },
    targetOrigin,
  );

  const nodes = [trigger, analyzing];
  const connections = {};
  connect(connections, trigger.name, analyzing.name);
  let previous = analyzing;
  let nextX = -280;
  let completionVersion = 1;

  if (definition.researching) {
    const researching = supabaseRpcNode(
      {
        id: `${definition.id}-researching`,
        name: "Mark Researching",
        position: [nextX, 0],
        bodyExpression: transitionExpression(route, 1, "researching", 35),
      },
      targetOrigin,
    );
    nodes.push(researching);
    connect(connections, previous.name, researching.name);
    previous = researching;
    nextX += 240;
    completionVersion = 2;
  }

  const download = downloadNode(`${definition.id}-download`, [nextX, 0], targetOrigin);
  const gemini = geminiNode(route, definition, `${definition.id}-gemini`, [
    nextX + 240,
    0,
  ]);
  const completed = supabaseRpcNode(
    {
      id: `${definition.id}-completed`,
      name: "Mark Completed",
      position: [nextX + 480, 0],
      bodyExpression: completionExpression(route, completionVersion),
    },
    targetOrigin,
  );
  nodes.push(download, gemini, completed);
  connect(connections, previous.name, download.name);
  connect(connections, download.name, gemini.name);
  connect(connections, gemini.name, completed.name);

  return {
    id: definition.id,
    name: definition.name,
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: {
      executionOrder: "v1",
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
      callerPolicy: "workflowsFromSameOwner",
    },
    versionId: definition.versionId,
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

export function buildAllSpecialistWorkflows(targetOrigin = SUPABASE_ORIGIN) {
  return Object.fromEntries(
    Object.keys(SPECIALIST_WORKFLOWS).map((route) => [
      route,
      buildSpecialistWorkflow(route, targetOrigin),
    ]),
  );
}

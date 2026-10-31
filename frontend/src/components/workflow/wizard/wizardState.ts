import type { WorkflowGraph } from "../../../api/workflowApi";
import {
  createConditionNode,
  createTaskNode,
  createTriggerNode,
  type ConditionOp,
  type ConditionValueType,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
} from "../nodes/node.types";
import { validateWorkflowGraphDetailed } from "../../../graphValidation";

export type TriggerKind = "event" | "schedule" | "webhook";
export type TaskAction = "http" | "sendEmail" | "sendSlack" | "dbQuery" | "transform";

export interface WizardTrigger {
  id: string;
  label: string;
  kind: TriggerKind;
  // Event trigger fields (approved event source)
  source: string;
  eventName: string;
  // Schedule trigger fields
  cron: string;
  timezone: string;
  // Webhook trigger fields
  webhookMethod: "GET" | "POST" | "PUT" | "DELETE";
  webhookPath: string;
}

export interface WizardTask {
  id: string;
  type: "task";
  label: string;
  action: TaskAction;
  // HTTP
  httpMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  httpUrl: string;
  // SendEmail
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  // SendSlack
  slackChannel: string;
  slackMessage: string;
  // dbQuery
  dbConnection: string;
  dbQuery: string;
  // transform
  transformExpression: string;
}

export interface WizardCondition {
  id: string;
  type: "condition";
  label: string;
  left: string;
  op: ConditionOp;
  right: unknown;
  rawValue: string;
  valueType: ConditionValueType;
  // Condition branch outcomes (both are mandatory in the graph contract)
  trueTarget: WizardTask;
  falseTarget: WizardTask;
}

export type WizardStep = WizardTask | WizardCondition;

export interface WizardState {
  currentStepIndex: number;
  name: string;
  description: string;
  trigger: WizardTrigger;
  steps: WizardStep[];
}

export function createDefaultTask(
  id: string,
  label: string,
  action: TaskAction = "http",
): WizardTask {
  return {
    id,
    type: "task",
    label,
    action,
    httpMethod: "POST",
    httpUrl: "https://api.example.com/action",
    emailTo: "team@example.com",
    emailSubject: "Workflow notification",
    emailBody: "A workflow step has completed.",
    slackChannel: "#general",
    slackMessage: "Workflow notification",
    dbConnection: "primary-db",
    dbQuery: "SELECT 1",
    transformExpression: "input",
  };
}

export function createDefaultCondition(
  id: string,
  label: string,
  trueTaskId = "task-true-1",
  falseTaskId = "task-false-1",
): WizardCondition {
  return {
    id,
    type: "condition",
    label,
    left: "approved",
    op: "equals",
    right: true,
    rawValue: "true",
    valueType: "boolean",
    trueTarget: createDefaultTask(trueTaskId, "Charge payment", "http"),
    falseTarget: createDefaultTask(falseTaskId, "Send review alert", "sendEmail"),
  };
}

export function createDefaultWizardState(
  name = "My New Workflow",
  description = "",
): WizardState {
  return {
    currentStepIndex: 0,
    name,
    description,
    trigger: {
      id: "trigger-1",
      label: "Business event received",
      kind: "event",
      source: "business_events",
      eventName: "order.created",
      cron: "0 * * * *",
      timezone: "UTC",
      webhookMethod: "POST",
      webhookPath: "/api/v1/webhook",
    },
    steps: [
      createDefaultCondition(
        "condition-1",
        "Is order approved?",
        "task-1",
        "task-2",
      ),
    ],
  };
}

/**
 * Builds the canonical TriggerConfig per docs/workflow-graph-contract.md §2.
 */
function buildTriggerConfig(trigger: WizardTrigger): Record<string, unknown> {
  if (trigger.kind === "event") {
    return {
      kind: "event",
      source: "business_events",
      eventName: trigger.eventName.trim() || "order.created",
    };
  }
  if (trigger.kind === "schedule") {
    return {
      kind: "schedule",
      cron: trigger.cron.trim() || "0 * * * *",
      timezone: trigger.timezone.trim() || "UTC",
    };
  }
  return {
    kind: "webhook",
    method: trigger.webhookMethod,
    path: trigger.webhookPath.trim() || "/api/v1/webhook",
  };
}

/**
 * Builds the canonical TaskConfig per docs/workflow-graph-contract.md §2.
 */
function buildTaskConfig(task: WizardTask): Record<string, unknown> {
  switch (task.action) {
    case "sendEmail":
      return {
        action: "sendEmail",
        to: task.emailTo.trim() || "team@example.com",
        subject: task.emailSubject.trim() || "Workflow notification",
        body: task.emailBody.trim() || "Step completed.",
      };
    case "sendSlack":
      return {
        action: "sendSlack",
        channel: task.slackChannel.trim() || "#general",
        message: task.slackMessage.trim() || "Workflow notification",
      };
    case "dbQuery":
      return {
        action: "dbQuery",
        connection: task.dbConnection.trim() || "primary-db",
        query: task.dbQuery.trim() || "SELECT 1",
      };
    case "transform":
      return {
        action: "transform",
        expression: task.transformExpression.trim() || "input",
      };
    case "http":
    default:
      return {
        action: "http",
        method: task.httpMethod,
        url: task.httpUrl.trim() || "https://api.example.com/action",
      };
  }
}

/**
 * Builds the canonical ConditionConfig per docs/workflow-graph-contract.md §2.
 */
function buildConditionConfig(condition: WizardCondition): Record<string, unknown> {
  return {
    type: "clause",
    clause: {
      left: condition.left.trim() || "approved",
      op: condition.op,
      right: condition.op === "truthy" ? undefined : condition.right,
    },
  };
}

/**
 * Deterministically constructs a canonical WorkflowGraph from WizardState.
 * Guarantees that:
 * 1. Exactly one trigger node exists at position (250, 50).
 * 2. Steps are sequentially linked with valid edges.
 * 3. Conditions have both required "true" and "false" branch edges with handles.
 * 4. All node types match node.data.type and contain valid configurations.
 */
export function buildCanonicalGraphFromWizard(state: WizardState): WorkflowGraph {
  const nodes: WorkflowFlowNode[] = [];
  const edges: WorkflowFlowEdge[] = [];

  // 1. Add Trigger Node
  const triggerNode = createTriggerNode(
    state.trigger.id || "trigger-1",
    { x: 250, y: 50 },
    state.trigger.label || "Trigger",
  );
  triggerNode.data.config = buildTriggerConfig(state.trigger);
  nodes.push(triggerNode);

  let currentSourceId = triggerNode.id;
  let currentY = 180;
  let edgeCounter = 1;

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i];

    if (step.type === "task") {
      const taskNode = createTaskNode(
        step.id,
        { x: 250, y: currentY },
        step.label || "Task",
      );
      taskNode.data.config = buildTaskConfig(step);
      nodes.push(taskNode);

      edges.push({
        id: `edge-${edgeCounter++}`,
        source: currentSourceId,
        target: taskNode.id,
      });

      currentSourceId = taskNode.id;
      currentY += 140;
    } else if (step.type === "condition") {
      const conditionNode = createConditionNode(
        step.id,
        { x: 250, y: currentY },
        step.label || "Condition",
      );
      conditionNode.data.config = buildConditionConfig(step);
      nodes.push(conditionNode);

      // Connect previous node to condition
      edges.push({
        id: `edge-${edgeCounter++}`,
        source: currentSourceId,
        target: conditionNode.id,
      });

      // Add True branch target node
      const trueTask = createTaskNode(
        step.trueTarget.id,
        { x: 80, y: currentY + 150 },
        step.trueTarget.label || "True branch action",
      );
      trueTask.data.config = buildTaskConfig(step.trueTarget);
      nodes.push(trueTask);

      // True branch edge
      edges.push({
        id: `edge-${edgeCounter++}`,
        source: conditionNode.id,
        sourceHandle: "true",
        target: trueTask.id,
      });

      // Add False branch target node
      const falseTask = createTaskNode(
        step.falseTarget.id,
        { x: 420, y: currentY + 150 },
        step.falseTarget.label || "False branch action",
      );
      falseTask.data.config = buildTaskConfig(step.falseTarget);
      nodes.push(falseTask);

      // False branch edge
      edges.push({
        id: `edge-${edgeCounter++}`,
        source: conditionNode.id,
        sourceHandle: "false",
        target: falseTask.id,
      });

      // Condition branch paths terminate this linear branch
      currentY += 300;
      currentSourceId = trueTask.id;
    }
  }

  return {
    version: 1,
    nodes,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== null && edge.sourceHandle !== undefined
        ? { sourceHandle: edge.sourceHandle }
        : {}),
      ...(edge.targetHandle !== null && edge.targetHandle !== undefined
        ? { targetHandle: edge.targetHandle }
        : {}),
    })),
  };
}

/**
 * Parses an existing task node's configuration into WizardTask, preserving
 * configured actions (HTTP, email, Slack, dbQuery, transform) and fields.
 */
function parseTaskConfig(
  node: { id?: string; data?: { label?: string; config?: unknown } } | undefined,
  fallbackId: string,
  fallbackLabel: string,
  fallbackAction: TaskAction = "http",
): WizardTask {
  if (!node) {
    return createDefaultTask(fallbackId, fallbackLabel, fallbackAction);
  }

  const id = node.id || fallbackId;
  const label = typeof node.data?.label === "string" ? node.data.label : fallbackLabel;
  const config =
    node.data?.config && typeof node.data.config === "object" && !Array.isArray(node.data.config)
      ? (node.data.config as Record<string, unknown>)
      : undefined;

  const validActions: TaskAction[] = ["http", "sendEmail", "sendSlack", "dbQuery", "transform"];
  let action: TaskAction = fallbackAction;

  if (config?.action && typeof config.action === "string" && validActions.includes(config.action as TaskAction)) {
    action = config.action as TaskAction;
  } else if (config) {
    if (typeof config.to === "string" || typeof config.emailTo === "string" || typeof config.subject === "string") {
      action = "sendEmail";
    } else if (typeof config.channel === "string" || typeof config.slackChannel === "string") {
      action = "sendSlack";
    } else if (typeof config.query === "string" || typeof config.connection === "string") {
      action = "dbQuery";
    } else if (typeof config.expression === "string" || typeof config.transformExpression === "string") {
      action = "transform";
    } else if (typeof config.url === "string" || typeof config.method === "string") {
      action = "http";
    }
  }

  const validMethods: Array<WizardTask["httpMethod"]> = ["GET", "POST", "PUT", "DELETE", "PATCH"];
  const rawMethod = config?.method ?? config?.httpMethod;
  const httpMethod: WizardTask["httpMethod"] =
    typeof rawMethod === "string" && validMethods.includes(rawMethod as WizardTask["httpMethod"])
      ? (rawMethod as WizardTask["httpMethod"])
      : "POST";

  const rawUrl = config?.url ?? config?.httpUrl;
  const rawTo = config?.to ?? config?.emailTo;
  const rawSubject = config?.subject ?? config?.emailSubject;
  const rawBody = config?.body ?? config?.emailBody;
  const rawChannel = config?.channel ?? config?.slackChannel;
  const rawMessage = config?.message ?? config?.slackMessage;
  const rawConnection = config?.connection ?? config?.dbConnection;
  const rawQuery = config?.query ?? config?.dbQuery;
  const rawExpression = config?.expression ?? config?.transformExpression;

  return {
    id,
    type: "task",
    label,
    action,
    httpMethod,
    httpUrl: typeof rawUrl === "string" ? rawUrl : "https://api.example.com/action",
    emailTo: typeof rawTo === "string" ? rawTo : "team@example.com",
    emailSubject: typeof rawSubject === "string" ? rawSubject : "Workflow notification",
    emailBody: typeof rawBody === "string" ? rawBody : "A workflow step has completed.",
    slackChannel: typeof rawChannel === "string" ? rawChannel : "#general",
    slackMessage: typeof rawMessage === "string" ? rawMessage : "Workflow notification",
    dbConnection: typeof rawConnection === "string" ? rawConnection : "primary-db",
    dbQuery: typeof rawQuery === "string" ? rawQuery : "SELECT 1",
    transformExpression: typeof rawExpression === "string" ? rawExpression : "input",
  };
}

/**
 * Safely parses an existing WorkflowGraph into a WizardState.
 * If the graph cannot be mapped to a linear wizard sequence (e.g. empty or unknown),
 * it returns a valid default wizard state populated with the available workflow name and description.
 */
export function parseGraphToWizardState(
  graph: WorkflowGraph | null | undefined,
  name = "My Workflow",
  description = "",
): WizardState {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return createDefaultWizardState(name, description);
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = graph.nodes;

  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) {
    return createDefaultWizardState(name, description);
  }

  const triggerConfig = (triggerNode.data?.config ?? {}) as Record<string, unknown>;
  const triggerKind: TriggerKind =
    triggerConfig.kind === "schedule" || triggerConfig.kind === "webhook"
      ? triggerConfig.kind
      : "event";

  const trigger: WizardTrigger = {
    id: triggerNode.id,
    label: triggerNode.data?.label || "Trigger",
    kind: triggerKind,
    source: String(triggerConfig.source || "business_events"),
    eventName: String(triggerConfig.eventName || "order.created"),
    cron: String(triggerConfig.cron || "0 * * * *"),
    timezone: String(triggerConfig.timezone || "UTC"),
    webhookMethod: (triggerConfig.method as WizardTrigger["webhookMethod"]) || "POST",
    webhookPath: String(triggerConfig.path || "/api/v1/webhook"),
  };

  const conditionNodes = nodes.filter((n) => n.type === "condition");
  const taskNodes = nodes.filter((n) => n.type === "task");
  const steps: WizardStep[] = [];
  const handledConditionTaskIds = new Set<string>();

  for (const condNode of conditionNodes) {
    const trueEdge = edges.find(
      (e) => e.source === condNode.id && e.sourceHandle === "true",
    );
    const falseEdge = edges.find(
      (e) => e.source === condNode.id && e.sourceHandle === "false",
    );
    if (trueEdge?.target) handledConditionTaskIds.add(trueEdge.target);
    if (falseEdge?.target) handledConditionTaskIds.add(falseEdge.target);
  }

  function parseSingleCondition(condNode: {
    id: string;
    data?: { label?: string; config?: unknown };
  }): WizardCondition {
    const conditionConfig = (condNode.data?.config ?? {}) as Record<string, unknown>;
    const clause =
      conditionConfig.type === "clause" &&
      typeof conditionConfig.clause === "object" &&
      conditionConfig.clause !== null
        ? (conditionConfig.clause as Record<string, unknown>)
        : { left: "approved", op: "equals", right: true };

    const trueEdge = edges.find(
      (e) => e.source === condNode.id && e.sourceHandle === "true",
    );
    const falseEdge = edges.find(
      (e) => e.source === condNode.id && e.sourceHandle === "false",
    );

    const trueNode = trueEdge ? taskNodes.find((n) => n.id === trueEdge.target) : undefined;
    const falseNode = falseEdge ? taskNodes.find((n) => n.id === falseEdge.target) : undefined;

    const trueTask: WizardTask = parseTaskConfig(
      trueNode,
      trueNode?.id || `task-true-${condNode.id}`,
      typeof trueNode?.data?.label === "string" ? trueNode.data.label : "True branch action",
      "http",
    );

    const falseTask: WizardTask = parseTaskConfig(
      falseNode,
      falseNode?.id || `task-false-${condNode.id}`,
      typeof falseNode?.data?.label === "string" ? falseNode.data.label : "False branch action",
      "sendEmail",
    );

    const isTruthyOp = clause.op === "truthy";
    const rightValue = clause.right;
    const valueType: ConditionValueType = isTruthyOp
      ? "boolean"
      : typeof rightValue === "boolean"
        ? "boolean"
        : typeof rightValue === "number"
          ? "number"
          : "string";

    return {
      id: condNode.id,
      type: "condition",
      label: typeof condNode.data?.label === "string" ? condNode.data.label : "Condition",
      left: String(clause.left ?? "approved"),
      op: (clause.op as ConditionOp) || "equals",
      right: isTruthyOp ? undefined : (rightValue !== undefined ? rightValue : true),
      rawValue: isTruthyOp ? "" : (rightValue !== undefined ? String(rightValue) : "true"),
      valueType,
      trueTarget: trueTask,
      falseTarget: falseTask,
    };
  }

  const visitedNodeIds = new Set<string>();
  visitedNodeIds.add(triggerNode.id);

  let currentSourceId: string | null = triggerNode.id;

  while (currentSourceId) {
    const nextEdge = edges.find(
      (e) => e.source === currentSourceId && (!e.sourceHandle || e.sourceHandle === "true"),
    );

    if (!nextEdge || !nextEdge.target || visitedNodeIds.has(nextEdge.target)) {
      break;
    }

    const nextNode = nodes.find((n) => n.id === nextEdge.target);
    if (!nextNode) break;

    visitedNodeIds.add(nextNode.id);

    if (nextNode.type === "condition") {
      const condStep = parseSingleCondition(nextNode);
      if (condStep.trueTarget.id) visitedNodeIds.add(condStep.trueTarget.id);
      if (condStep.falseTarget.id) visitedNodeIds.add(condStep.falseTarget.id);
      steps.push(condStep);
      currentSourceId = condStep.trueTarget.id;
    } else if (nextNode.type === "task") {
      if (!handledConditionTaskIds.has(nextNode.id)) {
        steps.push(
          parseTaskConfig(
            nextNode,
            nextNode.id,
            typeof nextNode.data?.label === "string" ? nextNode.data.label : "Task",
            "http",
          ),
        );
      }
      currentSourceId = nextNode.id;
    } else {
      break;
    }
  }

  // Preserve any condition nodes not encountered in the primary linear traversal
  for (const condNode of conditionNodes) {
    if (!visitedNodeIds.has(condNode.id)) {
      visitedNodeIds.add(condNode.id);
      const condStep = parseSingleCondition(condNode);
      if (condStep.trueTarget.id) visitedNodeIds.add(condStep.trueTarget.id);
      if (condStep.falseTarget.id) visitedNodeIds.add(condStep.falseTarget.id);
      steps.push(condStep);
    }
  }

  // Preserve any task nodes not encountered in the traversal and not condition branch targets
  for (const task of taskNodes) {
    if (!visitedNodeIds.has(task.id) && !handledConditionTaskIds.has(task.id)) {
      visitedNodeIds.add(task.id);
      steps.push(
        parseTaskConfig(
          task,
          task.id,
          typeof task.data?.label === "string" ? task.data.label : "Task",
          "http",
        ),
      );
    }
  }

  if (steps.length === 0) {
    steps.push(createDefaultCondition("condition-1", "Is order approved?"));
  }

  return {
    currentStepIndex: 0,
    name,
    description,
    trigger,
    steps,
  };
}

export interface WizardValidationError {
  step: number;
  field?: string;
  message: string;
}

/**
 * Validates the wizard state before moving between steps or saving.
 * Ensures all plain-English inputs satisfy both beginner UX and the underlying graph contract.
 */
export function validateWizardState(state: WizardState): WizardValidationError[] {
  const errors: WizardValidationError[] = [];

  // Step 0: Details validation
  const trimmedName = state.name.trim();
  if (!trimmedName) {
    errors.push({
      step: 0,
      field: "name",
      message: "Please enter a workflow name.",
    });
  } else if (trimmedName.length > 120) {
    errors.push({
      step: 0,
      field: "name",
      message: "Workflow name must be 120 characters or fewer.",
    });
  }

  if (state.description && state.description.length > 2000) {
    errors.push({
      step: 0,
      field: "description",
      message: "Description must be 2000 characters or fewer.",
    });
  }

  // Step 1: Trigger validation
  if (!state.trigger.label.trim()) {
    errors.push({
      step: 1,
      field: "trigger.label",
      message: "Please enter a label for your trigger.",
    });
  }

  if (state.trigger.kind === "event") {
    if (!state.trigger.eventName.trim()) {
      errors.push({
        step: 1,
        field: "trigger.eventName",
        message: "Please enter an event name (e.g., 'order.created').",
      });
    }
  } else if (state.trigger.kind === "schedule") {
    if (!state.trigger.cron.trim()) {
      errors.push({
        step: 1,
        field: "trigger.cron",
        message: "Please enter a cron expression.",
      });
    }
  } else if (state.trigger.kind === "webhook") {
    if (!state.trigger.webhookPath.trim()) {
      errors.push({
        step: 1,
        field: "trigger.webhookPath",
        message: "Please enter a webhook path.",
      });
    }
  }

  // Step 2: Steps validation
  if (state.steps.length === 0) {
    errors.push({
      step: 2,
      message: "Please add at least one action or decision step to your workflow.",
    });
  }

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i];
    if (!step.label.trim()) {
      errors.push({
        step: 2,
        message: `Step ${i + 1} needs a name or title.`,
      });
    }

    if (step.type === "condition") {
      if (!step.left.trim()) {
        errors.push({
          step: 2,
          message: `Decision "${step.label || `Step ${i + 1}`}" is missing what field to check.`,
        });
      }
      if (!step.trueTarget.label.trim()) {
        errors.push({
          step: 2,
          message: `Decision "${step.label || `Step ${i + 1}`}" needs an action for the Yes (True) outcome.`,
        });
      }
      if (!step.falseTarget.label.trim()) {
        errors.push({
          step: 2,
          message: `Decision "${step.label || `Step ${i + 1}`}" needs an action for the No (False) outcome.`,
        });
      }
    }
  }

  // Also verify that the synthesized canonical graph passes contract validation
  if (errors.length === 0) {
    const canonicalGraph = buildCanonicalGraphFromWizard(state);
    const contractIssues = validateWorkflowGraphDetailed(canonicalGraph);
    for (const issue of contractIssues) {
      errors.push({
        step: 3,
        message: issue.message,
      });
    }
  }

  return errors;
}

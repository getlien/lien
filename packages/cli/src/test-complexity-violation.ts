/**
 * This file contains intentionally complex code to test the AI review action.
 * DO NOT merge this file - it exists only to trigger the AI review workflow.
 */

type Status = 'pending' | 'active' | 'completed' | 'cancelled' | 'error' | 'retry';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface Task {
  id: string;
  status: Status;
  priority: Priority;
  retryCount: number;
  hasSubtasks: boolean;
  isBlocked: boolean;
  dueDate?: Date;
}

/**
 * Intentionally complex function for testing AI review.
 * This function has high cyclomatic complexity due to nested conditionals.
 * 
 * Complexity: ~25+ (should trigger error threshold at 15)
 */
export function processTaskWithExcessiveComplexity(
  task: Task,
  userRole: string,
  isWeekend: boolean,
  systemLoad: number
): string {
  let result = '';
  
  // Nested conditionals to increase complexity
  if (task.status === 'pending') {
    if (task.priority === 'critical') {
      if (userRole === 'admin') {
        if (!isWeekend) {
          result = 'immediate_processing';
        } else {
          if (systemLoad < 50) {
            result = 'weekend_critical_low_load';
          } else {
            result = 'weekend_critical_high_load';
          }
        }
      } else if (userRole === 'manager') {
        result = 'manager_review_required';
      } else {
        result = 'escalate_to_manager';
      }
    } else if (task.priority === 'high') {
      if (task.hasSubtasks) {
        if (task.isBlocked) {
          result = 'unblock_subtasks_first';
        } else {
          result = 'process_subtasks';
        }
      } else {
        result = 'standard_high_priority';
      }
    } else if (task.priority === 'medium') {
      if (isWeekend) {
        result = 'defer_to_weekday';
      } else {
        result = 'queue_medium_priority';
      }
    } else {
      result = 'queue_low_priority';
    }
  } else if (task.status === 'active') {
    if (task.retryCount > 3) {
      if (task.priority === 'critical' || task.priority === 'high') {
        result = 'manual_intervention_required';
      } else {
        result = 'cancel_after_retries';
      }
    } else {
      if (systemLoad > 80) {
        result = 'pause_for_load';
      } else {
        result = 'continue_processing';
      }
    }
  } else if (task.status === 'error') {
    if (task.retryCount < 3) {
      result = 'retry_task';
    } else {
      if (task.priority === 'critical') {
        result = 'alert_oncall';
      } else {
        result = 'log_and_archive';
      }
    }
  } else if (task.status === 'retry') {
    if (task.dueDate && task.dueDate < new Date()) {
      result = 'expired_during_retry';
    } else {
      result = 'requeue_for_retry';
    }
  } else {
    result = 'no_action_needed';
  }
  
  return result;
}

/**
 * Another complex function with switch + nested if statements.
 * 
 * Complexity: ~18 (should trigger warning/error)
 */
export function calculatePriorityScore(
  task: Task,
  teamCapacity: number,
  backlogSize: number
): number {
  let score = 0;
  
  switch (task.priority) {
    case 'critical':
      score = 100;
      if (task.isBlocked) {
        score -= 20;
      }
      if (task.dueDate) {
        const daysUntilDue = Math.floor(
          (task.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysUntilDue < 1) {
          score += 50;
        } else if (daysUntilDue < 3) {
          score += 25;
        }
      }
      break;
    case 'high':
      score = 75;
      if (teamCapacity < 50) {
        score -= 10;
      }
      break;
    case 'medium':
      score = 50;
      if (backlogSize > 100) {
        score -= 15;
      } else if (backlogSize < 20) {
        score += 10;
      }
      break;
    case 'low':
      score = 25;
      if (task.hasSubtasks) {
        score += 5;
      }
      break;
    default:
      score = 0;
  }
  
  // Additional adjustments
  if (task.status === 'retry') {
    score = Math.floor(score * 0.8);
  }
  
  if (task.retryCount > 0) {
    score -= task.retryCount * 5;
  }
  
  return Math.max(0, Math.min(100, score));
}


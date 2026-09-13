import { pgTable, text, timestamp, integer, uuid, jsonb, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Firebase UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  question: text('question').notNull(),
  industry: text('industry').notNull(),
  geography: text('geography').notNull(),
  timeHorizon: text('time_horizon').notNull(),
  status: text('status').notNull(),
  currentStage: text('current_stage').notNull(),
  progress: integer('progress').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  objectivesJson: jsonb('objectives_json'),
  statsJson: jsonb('stats_json'),
  stagesJson: jsonb('stages_json'),
});

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  stage: text('stage').notNull(),
  progress: integer('progress').notNull(),
  metadataJson: jsonb('metadata_json'),
});

export const reports = pgTable('reports', {
  jobId: text('job_id').primaryKey().references(() => jobs.id),
  reportData: jsonb('report_data').notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});

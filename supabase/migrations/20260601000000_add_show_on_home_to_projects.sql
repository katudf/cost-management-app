-- Add show_on_home column to Projects table
ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT true;

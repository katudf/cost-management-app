export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      Assignments: {
        Row: {
          assignment_order: number | null
          created_at: string | null
          date: string | null
          id: number
          projectId: number | null
          projectTaskId: number | null
          title: string | null
          workerId: number | null
        }
        Insert: {
          assignment_order?: number | null
          created_at?: string | null
          date?: string | null
          id?: number
          projectId?: number | null
          projectTaskId?: number | null
          title?: string | null
          workerId?: number | null
        }
        Update: {
          assignment_order?: number | null
          created_at?: string | null
          date?: string | null
          id?: number
          projectId?: number | null
          projectTaskId?: number | null
          title?: string | null
          workerId?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "Assignments_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Assignments_projectTaskId_fkey"
            columns: ["projectTaskId"]
            isOneToOne: false
            referencedRelation: "ProjectTasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Assignments_workerId_fkey"
            columns: ["workerId"]
            isOneToOne: false
            referencedRelation: "Workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Assignments_workerId_fkey"
            columns: ["workerId"]
            isOneToOne: false
            referencedRelation: "workers_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      CertificationNames: {
        Row: {
          created_at: string | null
          id: number
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      coating_system_abbreviations: {
        Row: {
          abbreviation_id: number
          coating_system_id: number
          created_at: string
        }
        Insert: {
          abbreviation_id: number
          coating_system_id: number
          created_at?: string
        }
        Update: {
          abbreviation_id?: number
          coating_system_id?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coating_system_abbreviations_abbreviation_id_fkey"
            columns: ["abbreviation_id"]
            isOneToOne: false
            referencedRelation: "paint_abbreviations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coating_system_abbreviations_coating_system_id_fkey"
            columns: ["coating_system_id"]
            isOneToOne: false
            referencedRelation: "coating_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      coating_system_steps: {
        Row: {
          coat_count: number
          coating_system_id: number
          created_at: string
          id: number
          process_role_id: number
          product_id: number
          step_order: number
        }
        Insert: {
          coat_count?: number
          coating_system_id: number
          created_at?: string
          id?: number
          process_role_id: number
          product_id: number
          step_order: number
        }
        Update: {
          coat_count?: number
          coating_system_id?: number
          created_at?: string
          id?: number
          process_role_id?: number
          product_id?: number
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "coating_system_steps_coating_system_id_fkey"
            columns: ["coating_system_id"]
            isOneToOne: false
            referencedRelation: "coating_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coating_system_steps_process_role_id_fkey"
            columns: ["process_role_id"]
            isOneToOne: false
            referencedRelation: "paint_process_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coating_system_steps_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "paint_products"
            referencedColumns: ["id"]
          },
        ]
      }
      coating_system_variants: {
        Row: {
          application_method: string | null
          area_max: number | null
          area_min: number | null
          coating_system_id: number
          created_at: string
          finish_type: string | null
          id: number
          jis_a6909_compliant: boolean
          joint_type: string | null
          material_labor_price: number | null
          process_count: number | null
          updated_at: string
        }
        Insert: {
          application_method?: string | null
          area_max?: number | null
          area_min?: number | null
          coating_system_id: number
          created_at?: string
          finish_type?: string | null
          id?: number
          jis_a6909_compliant?: boolean
          joint_type?: string | null
          material_labor_price?: number | null
          process_count?: number | null
          updated_at?: string
        }
        Update: {
          application_method?: string | null
          area_max?: number | null
          area_min?: number | null
          coating_system_id?: number
          created_at?: string
          finish_type?: string | null
          id?: number
          jis_a6909_compliant?: boolean
          joint_type?: string | null
          material_labor_price?: number | null
          process_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coating_system_variants_coating_system_id_fkey"
            columns: ["coating_system_id"]
            isOneToOne: false
            referencedRelation: "coating_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      coating_systems: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: number
          name: string
          primary_product_id: number | null
          target_use: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: number
          name: string
          primary_product_id?: number | null
          target_use?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: number
          name?: string
          primary_product_id?: number | null
          target_use?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coating_systems_primary_product_id_fkey"
            columns: ["primary_product_id"]
            isOneToOne: false
            referencedRelation: "paint_products"
            referencedColumns: ["id"]
          },
        ]
      }
      CompanyHolidays: {
        Row: {
          created_at: string
          date: string
          description: string | null
          id: number
        }
        Insert: {
          created_at?: string
          date: string
          description?: string | null
          id?: number
        }
        Update: {
          created_at?: string
          date?: string
          description?: string | null
          id?: number
        }
        Relationships: []
      }
      Customers: {
        Row: {
          address: string | null
          contactPerson: string | null
          created_at: string
          id: number
          name: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          contactPerson?: string | null
          created_at?: string
          id?: number
          name?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          contactPerson?: string | null
          created_at?: string
          id?: number
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      estimate_items: {
        Row: {
          amount: number | null
          category_symbol: string | null
          created_at: string
          estimate_id: number
          id: number
          item_type: string
          linked_category_item_id: number | null
          linked_sheet_id: string | null
          name: string
          note: string | null
          parent_id: number | null
          quantity: number | null
          sheet_id: string | null
          sort_order: number
          spec: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          category_symbol?: string | null
          created_at?: string
          estimate_id: number
          id?: number
          item_type: string
          linked_category_item_id?: number | null
          linked_sheet_id?: string | null
          name: string
          note?: string | null
          parent_id?: number | null
          quantity?: number | null
          sheet_id?: string | null
          sort_order?: number
          spec?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          category_symbol?: string | null
          created_at?: string
          estimate_id?: number
          id?: number
          item_type?: string
          linked_category_item_id?: number | null
          linked_sheet_id?: string | null
          name?: string
          note?: string | null
          parent_id?: number | null
          quantity?: number | null
          sheet_id?: string | null
          sort_order?: number
          spec?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "v_estimate_category_totals"
            referencedColumns: ["estimate_id"]
          },
          {
            foreignKeyName: "estimate_items_linked_category_item_id_fkey"
            columns: ["linked_category_item_id"]
            isOneToOne: false
            referencedRelation: "estimate_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_linked_category_item_id_fkey"
            columns: ["linked_category_item_id"]
            isOneToOne: false
            referencedRelation: "v_estimate_category_totals"
            referencedColumns: ["category_item_id"]
          },
          {
            foreignKeyName: "estimate_items_linked_sheet_id_fkey"
            columns: ["linked_sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "estimate_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_estimate_category_totals"
            referencedColumns: ["category_item_id"]
          },
          {
            foreignKeyName: "estimate_items_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "estimate_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_sheets: {
        Row: {
          created_at: string
          estimate_id: number
          id: string
          sort_order: number
          title: string | null
        }
        Insert: {
          created_at?: string
          estimate_id: number
          id?: string
          sort_order?: number
          title?: string | null
        }
        Update: {
          created_at?: string
          estimate_id?: number
          id?: string
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_sheets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_sheets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "v_estimate_category_totals"
            referencedColumns: ["estimate_id"]
          },
        ]
      }
      estimates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approver_staff_id: number | null
          created_at: string
          created_by: number | null
          customer_honorific: string | null
          customer_id: number
          deleted_at: string | null
          estimate_number: string
          id: number
          issue_date: string
          lost_reason: string | null
          net_amount: number | null
          net_calc_type: string | null
          net_perc: number | null
          notes: string | null
          payment_terms: string
          project_id: number | null
          returned_reason: string | null
          show_approver: boolean
          show_fixed_fees: boolean
          show_net: boolean
          show_subtotals: boolean
          site_location: string | null
          staff_id: number | null
          stamp_header: string
          status: string
          tax_rate: number
          title: string
          total_with_tax: number | null
          updated_at: string
          valid_until: string | null
          work_period: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approver_staff_id?: number | null
          created_at?: string
          created_by?: number | null
          customer_honorific?: string | null
          customer_id: number
          deleted_at?: string | null
          estimate_number: string
          id?: number
          issue_date?: string
          lost_reason?: string | null
          net_amount?: number | null
          net_calc_type?: string | null
          net_perc?: number | null
          notes?: string | null
          payment_terms?: string
          project_id?: number | null
          returned_reason?: string | null
          show_approver?: boolean
          show_fixed_fees?: boolean
          show_net?: boolean
          show_subtotals?: boolean
          site_location?: string | null
          staff_id?: number | null
          stamp_header?: string
          status?: string
          tax_rate?: number
          title: string
          total_with_tax?: number | null
          updated_at?: string
          valid_until?: string | null
          work_period?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approver_staff_id?: number | null
          created_at?: string
          created_by?: number | null
          customer_honorific?: string | null
          customer_id?: number
          deleted_at?: string | null
          estimate_number?: string
          id?: number
          issue_date?: string
          lost_reason?: string | null
          net_amount?: number | null
          net_calc_type?: string | null
          net_perc?: number | null
          notes?: string | null
          payment_terms?: string
          project_id?: number | null
          returned_reason?: string | null
          show_approver?: boolean
          show_fixed_fees?: boolean
          show_net?: boolean
          show_subtotals?: boolean
          site_location?: string | null
          staff_id?: number | null
          stamp_header?: string
          status?: string
          tax_rate?: number
          title?: string
          total_with_tax?: number | null
          updated_at?: string
          valid_until?: string | null
          work_period?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_approver_staff_id_fkey"
            columns: ["approver_staff_id"]
            isOneToOne: false
            referencedRelation: "office_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "Workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workers_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "Customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "office_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      InventoryItems: {
        Row: {
          appsheet_id: string | null
          category: string | null
          created_at: string | null
          detail: string | null
          id: number
          image_url_1: string | null
          image_url_2: string | null
          image_url_3: string | null
          name: string
          quantity: number
          recorded_by: string | null
          recorded_date: string | null
          shelf_code: string | null
          slot_number: number | null
          updated_at: string | null
          warehouse_id: number | null
          worker_id: number | null
        }
        Insert: {
          appsheet_id?: string | null
          category?: string | null
          created_at?: string | null
          detail?: string | null
          id?: never
          image_url_1?: string | null
          image_url_2?: string | null
          image_url_3?: string | null
          name: string
          quantity?: number
          recorded_by?: string | null
          recorded_date?: string | null
          shelf_code?: string | null
          slot_number?: number | null
          updated_at?: string | null
          warehouse_id?: number | null
          worker_id?: number | null
        }
        Update: {
          appsheet_id?: string | null
          category?: string | null
          created_at?: string | null
          detail?: string | null
          id?: never
          image_url_1?: string | null
          image_url_2?: string | null
          image_url_3?: string | null
          name?: string
          quantity?: number
          recorded_by?: string | null
          recorded_date?: string | null
          shelf_code?: string | null
          slot_number?: number | null
          updated_at?: string | null
          warehouse_id?: number | null
          worker_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "InventoryItems_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "Warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InventoryItems_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "Workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InventoryItems_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      office_staff: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          id: number
          is_approver: boolean
          name: string
          role: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: number
          is_approver?: boolean
          name: string
          role?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: number
          is_approver?: boolean
          name?: string
          role?: string | null
        }
        Relationships: []
      }
      OvertimeApprovals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_hours: number | null
          created_at: string | null
          date: string
          id: number
          project_id: number
          reason: string | null
          requested_hours: number
          status: string
          updated_at: string | null
          worker_name: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_hours?: number | null
          created_at?: string | null
          date: string
          id?: never
          project_id: number
          reason?: string | null
          requested_hours?: number
          status?: string
          updated_at?: string | null
          worker_name: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_hours?: number | null
          created_at?: string | null
          date?: string
          id?: never
          project_id?: number
          reason?: string | null
          requested_hours?: number
          status?: string
          updated_at?: string | null
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "OvertimeApprovals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
        ]
      }
      paint_abbreviations: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: number
          name: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: number
          name?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: number
          name?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      paint_classification_axes: {
        Row: {
          created_at: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      paint_classification_tags: {
        Row: {
          axis_id: number
          created_at: string
          id: number
          sort_order: number | null
          value: string
        }
        Insert: {
          axis_id: number
          created_at?: string
          id?: number
          sort_order?: number | null
          value: string
        }
        Update: {
          axis_id?: number
          created_at?: string
          id?: number
          sort_order?: number | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "paint_classification_tags_axis_id_fkey"
            columns: ["axis_id"]
            isOneToOne: false
            referencedRelation: "paint_classification_axes"
            referencedColumns: ["id"]
          },
        ]
      }
      paint_manufacturers: {
        Row: {
          created_at: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      paint_process_roles: {
        Row: {
          created_at: string
          id: number
          name: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      paint_product_standards: {
        Row: {
          created_at: string
          product_id: number
          standard_id: number
        }
        Insert: {
          created_at?: string
          product_id: number
          standard_id: number
        }
        Update: {
          created_at?: string
          product_id?: number
          standard_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "paint_product_standards_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "paint_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paint_product_standards_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "paint_standards"
            referencedColumns: ["id"]
          },
        ]
      }
      paint_product_tags: {
        Row: {
          created_at: string
          product_id: number
          tag_id: number
        }
        Insert: {
          created_at?: string
          product_id: number
          tag_id: number
        }
        Update: {
          created_at?: string
          product_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "paint_product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "paint_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paint_product_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "paint_classification_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      paint_products: {
        Row: {
          created_at: string
          deleted_at: string | null
          dilution_rate: string | null
          drying_time: string | null
          formaldehyde_grade: string | null
          id: number
          manufacturer_id: number
          name: string
          pot_life: string | null
          process_role_id: number
          product_code: string | null
          recoat_interval_max_days: number | null
          recoat_interval_standard_days: number | null
          reference_price: number | null
          reference_price_unit: string | null
          standard_usage_rate: number | null
          updated_at: string
          usage_rate_unit: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dilution_rate?: string | null
          drying_time?: string | null
          formaldehyde_grade?: string | null
          id?: number
          manufacturer_id: number
          name: string
          pot_life?: string | null
          process_role_id: number
          product_code?: string | null
          recoat_interval_max_days?: number | null
          recoat_interval_standard_days?: number | null
          reference_price?: number | null
          reference_price_unit?: string | null
          standard_usage_rate?: number | null
          updated_at?: string
          usage_rate_unit?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dilution_rate?: string | null
          drying_time?: string | null
          formaldehyde_grade?: string | null
          id?: number
          manufacturer_id?: number
          name?: string
          pot_life?: string | null
          process_role_id?: number
          product_code?: string | null
          recoat_interval_max_days?: number | null
          recoat_interval_standard_days?: number | null
          reference_price?: number | null
          reference_price_unit?: string | null
          standard_usage_rate?: number | null
          updated_at?: string
          usage_rate_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paint_products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "paint_manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paint_products_process_role_id_fkey"
            columns: ["process_role_id"]
            isOneToOne: false
            referencedRelation: "paint_process_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      paint_standards: {
        Row: {
          code: string
          created_at: string
          id: number
          is_abolished: boolean
          name: string | null
          sort_order: number
          standard_type: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: number
          is_abolished?: boolean
          name?: string | null
          sort_order?: number
          standard_type: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: number
          is_abolished?: boolean
          name?: string | null
          sort_order?: number
          standard_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      Projects: {
        Row: {
          bar_color: string | null
          contractPdfUrl: string | null
          created_at: string
          customerId: number | null
          display_order: number | null
          endDate: string | null
          estimatedAmount: number | null
          estimatePdfUrl: string | null
          finalAmount: number | null
          foreman_worker_id: number | null
          id: number
          is_prime_contractor: boolean | null
          isPaid: boolean | null
          name: string | null
          order: number
          show_on_home: boolean | null
          startDate: string | null
          status: string | null
          taxAmount: number | null
        }
        Insert: {
          bar_color?: string | null
          contractPdfUrl?: string | null
          created_at?: string
          customerId?: number | null
          display_order?: number | null
          endDate?: string | null
          estimatedAmount?: number | null
          estimatePdfUrl?: string | null
          finalAmount?: number | null
          foreman_worker_id?: number | null
          id?: number
          is_prime_contractor?: boolean | null
          isPaid?: boolean | null
          name?: string | null
          order: number
          show_on_home?: boolean | null
          startDate?: string | null
          status?: string | null
          taxAmount?: number | null
        }
        Update: {
          bar_color?: string | null
          contractPdfUrl?: string | null
          created_at?: string
          customerId?: number | null
          display_order?: number | null
          endDate?: string | null
          estimatedAmount?: number | null
          estimatePdfUrl?: string | null
          finalAmount?: number | null
          foreman_worker_id?: number | null
          id?: number
          is_prime_contractor?: boolean | null
          isPaid?: boolean | null
          name?: string | null
          order?: number
          show_on_home?: boolean | null
          startDate?: string | null
          status?: string | null
          taxAmount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "Projects_customerId_fkey"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "Customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Projects_foreman_worker_id_fkey"
            columns: ["foreman_worker_id"]
            isOneToOne: false
            referencedRelation: "Workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Projects_foreman_worker_id_fkey"
            columns: ["foreman_worker_id"]
            isOneToOne: false
            referencedRelation: "workers_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectSuspensions: {
        Row: {
          created_at: string | null
          end_date: string
          id: number
          project_id: number
          reason: string | null
          start_date: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: number
          project_id: number
          reason?: string | null
          start_date: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: number
          project_id?: number
          reason?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectSuspensions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectTasks: {
        Row: {
          created_at: string
          endDate: string | null
          estimated_amount: number
          id: number
          name: string | null
          order: number | null
          progress_percentage: number | null
          projectId: number | null
          serviceMasterId: number | null
          startDate: string | null
          status: string | null
          target_hours: number | null
        }
        Insert: {
          created_at?: string
          endDate?: string | null
          estimated_amount?: number
          id?: number
          name?: string | null
          order?: number | null
          progress_percentage?: number | null
          projectId?: number | null
          serviceMasterId?: number | null
          startDate?: string | null
          status?: string | null
          target_hours?: number | null
        }
        Update: {
          created_at?: string
          endDate?: string | null
          estimated_amount?: number
          id?: number
          name?: string | null
          order?: number | null
          progress_percentage?: number | null
          projectId?: number | null
          serviceMasterId?: number | null
          startDate?: string | null
          status?: string | null
          target_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ProjectTasks_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
        ]
      }
      PurchaseRecords: {
        Row: {
          amount: number | null
          created_at: string
          date: string | null
          id: number
          item_name: string | null
          note: string | null
          paint_product_id: number | null
          project_name: string | null
          quantity: number | null
          supplier: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: number
          item_name?: string | null
          note?: string | null
          paint_product_id?: number | null
          project_name?: string | null
          quantity?: number | null
          supplier?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: number
          item_name?: string | null
          note?: string | null
          paint_product_id?: number | null
          project_name?: string | null
          quantity?: number | null
          supplier?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "PurchaseRecords_paint_product_id_fkey"
            columns: ["paint_product_id"]
            isOneToOne: false
            referencedRelation: "paint_products"
            referencedColumns: ["id"]
          },
        ]
      }
      SubcontractorRecords: {
        Row: {
          company_name: string
          created_at: string
          date: string
          id: string
          project_id: number
          unit_price: number
          worker_count: number
          worker_name: string | null
        }
        Insert: {
          company_name: string
          created_at?: string
          date: string
          id?: string
          project_id: number
          unit_price?: number
          worker_count: number
          worker_name?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string
          date?: string
          id?: string
          project_id?: number
          unit_price?: number
          worker_count?: number
          worker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "SubcontractorRecords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          company_address: string | null
          company_fax: string | null
          company_name: string | null
          company_tel: string | null
          company_zip: string | null
          est_default_show_approver: boolean
          est_default_show_fixed_fees: boolean
          est_default_show_net: boolean
          est_default_show_subtotals: boolean
          est_default_stamp_header: string
          est_default_valid_days: number
          gemini_api_key: string | null
          hourly_wage: number
          id: number
          lineworks_enabled: boolean
          stamp_approver_url: string | null
          stamp_company_url: string | null
          stamp_representative_url: string | null
          updated_at: string
        }
        Insert: {
          company_address?: string | null
          company_fax?: string | null
          company_name?: string | null
          company_tel?: string | null
          company_zip?: string | null
          est_default_show_approver?: boolean
          est_default_show_fixed_fees?: boolean
          est_default_show_net?: boolean
          est_default_show_subtotals?: boolean
          est_default_stamp_header?: string
          est_default_valid_days?: number
          gemini_api_key?: string | null
          hourly_wage?: number
          id?: number
          lineworks_enabled?: boolean
          stamp_approver_url?: string | null
          stamp_company_url?: string | null
          stamp_representative_url?: string | null
          updated_at?: string
        }
        Update: {
          company_address?: string | null
          company_fax?: string | null
          company_name?: string | null
          company_tel?: string | null
          company_zip?: string | null
          est_default_show_approver?: boolean
          est_default_show_fixed_fees?: boolean
          est_default_show_net?: boolean
          est_default_show_subtotals?: boolean
          est_default_stamp_header?: string
          est_default_valid_days?: number
          gemini_api_key?: string | null
          hourly_wage?: number
          id?: number
          lineworks_enabled?: boolean
          stamp_approver_url?: string | null
          stamp_company_url?: string | null
          stamp_representative_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      TaskRecords: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          hours: number
          id: number
          note: string | null
          overtime_hours: number
          project_id: number
          project_task_id: number
          start_time: string | null
          work_allowance: boolean | null
          worker_name: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          hours?: number
          id?: number
          note?: string | null
          overtime_hours?: number
          project_id: number
          project_task_id: number
          start_time?: string | null
          work_allowance?: boolean | null
          worker_name: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          hours?: number
          id?: number
          note?: string | null
          overtime_hours?: number
          project_id?: number
          project_task_id?: number
          start_time?: string | null
          work_allowance?: boolean | null
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskRecords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskRecords_project_task_id_fkey"
            columns: ["project_task_id"]
            isOneToOne: false
            referencedRelation: "ProjectTasks"
            referencedColumns: ["id"]
          },
        ]
      }
      Warehouses: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: number
          map_image_url: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: never
          map_image_url?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: never
          map_image_url?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      WorkAllowanceApprovals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_task_names: string[] | null
          created_at: string | null
          date: string
          id: number
          project_id: number
          status: string
          task_names: string[]
          updated_at: string | null
          worker_name: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_task_names?: string[] | null
          created_at?: string | null
          date: string
          id?: never
          project_id: number
          status?: string
          task_names?: string[]
          updated_at?: string | null
          worker_name: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_task_names?: string[] | null
          created_at?: string | null
          date?: string
          id?: never
          project_id?: number
          status?: string
          task_names?: string[]
          updated_at?: string | null
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "WorkAllowanceApprovals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Projects"
            referencedColumns: ["id"]
          },
        ]
      }
      WorkerCertifications: {
        Row: {
          acquisitionDate: string | null
          created_at: string
          expiryDate: string | null
          id: number
          name: string | null
          registrationNumber: string | null
          workerId: number | null
        }
        Insert: {
          acquisitionDate?: string | null
          created_at?: string
          expiryDate?: string | null
          id?: number
          name?: string | null
          registrationNumber?: string | null
          workerId?: number | null
        }
        Update: {
          acquisitionDate?: string | null
          created_at?: string
          expiryDate?: string | null
          id?: number
          name?: string | null
          registrationNumber?: string | null
          workerId?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "WorkerCertifications_workerId_fkey"
            columns: ["workerId"]
            isOneToOne: false
            referencedRelation: "Workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "WorkerCertifications_workerId_fkey"
            columns: ["workerId"]
            isOneToOne: false
            referencedRelation: "workers_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      Workers: {
        Row: {
          address: string | null
          birthDate: string | null
          contactInfo: string | null
          cpdsNumber: string | null
          created_at: string
          display_order: number | null
          hireDate: string | null
          id: number
          kana: string | null
          lineworks_user_id: string | null
          name: string | null
          order: number | null
          resignation_date: string | null
          stamp_url: string | null
          worker_type: string
        }
        Insert: {
          address?: string | null
          birthDate?: string | null
          contactInfo?: string | null
          cpdsNumber?: string | null
          created_at?: string
          display_order?: number | null
          hireDate?: string | null
          id?: number
          kana?: string | null
          lineworks_user_id?: string | null
          name?: string | null
          order?: number | null
          resignation_date?: string | null
          stamp_url?: string | null
          worker_type?: string
        }
        Update: {
          address?: string | null
          birthDate?: string | null
          contactInfo?: string | null
          cpdsNumber?: string | null
          created_at?: string
          display_order?: number | null
          hireDate?: string | null
          id?: number
          kana?: string | null
          lineworks_user_id?: string | null
          name?: string | null
          order?: number | null
          resignation_date?: string | null
          stamp_url?: string | null
          worker_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_estimate_category_totals: {
        Row: {
          category_amount: number | null
          category_item_id: number | null
          category_name: string | null
          category_symbol: string | null
          estimate_id: number | null
          estimate_number: string | null
          estimate_title: string | null
        }
        Relationships: []
      }
      workers_directory: {
        Row: {
          display_order: number | null
          id: number | null
          name: string | null
          resignation_date: string | null
          worker_type: string | null
        }
        Insert: {
          display_order?: number | null
          id?: number | null
          name?: string | null
          resignation_date?: string | null
          worker_type?: string | null
        }
        Update: {
          display_order?: number | null
          id?: number | null
          name?: string | null
          resignation_date?: string | null
          worker_type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      approve_estimate: { Args: { p_estimate_id: number }; Returns: undefined }
      current_staff_role: { Args: never; Returns: string }
      get_next_estimate_seq: { Args: { date_prefix: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_approver_staff: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      overwrite_paste: { Args: { paste_data: Json }; Returns: undefined }
      purge_expired_estimates: { Args: never; Returns: number }
      restore_estimate: { Args: { p_estimate_id: number }; Returns: undefined }
      return_estimate: {
        Args: { p_estimate_id: number; p_reason: string }
        Returns: undefined
      }
      save_estimate_items_v2: {
        Args: { p_estimate_id: number; p_items: Json; p_sheets: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

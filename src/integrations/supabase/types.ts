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
      app_settings: {
        Row: {
          description: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      employee_aliases: {
        Row: {
          alias_name: string
          created_at: string
          employee_id: string
          id: string
          normalized_alias_name: string
          source: string | null
          updated_at: string
        }
        Insert: {
          alias_name: string
          created_at?: string
          employee_id: string
          id?: string
          normalized_alias_name: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          alias_name?: string
          created_at?: string
          employee_id?: string
          id?: string
          normalized_alias_name?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_aliases_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          admission_date: string | null
          created_at: string
          full_name: string
          id: string
          normalized_name: string
          payroll_code: string | null
          registration_number: string | null
          role: string | null
          section_code: string | null
          section_name: string | null
          status: string
          termination_date: string | null
          updated_at: string
        }
        Insert: {
          admission_date?: string | null
          created_at?: string
          full_name: string
          id?: string
          normalized_name: string
          payroll_code?: string | null
          registration_number?: string | null
          role?: string | null
          section_code?: string | null
          section_name?: string | null
          status?: string
          termination_date?: string | null
          updated_at?: string
        }
        Update: {
          admission_date?: string | null
          created_at?: string
          full_name?: string
          id?: string
          normalized_name?: string
          payroll_code?: string | null
          registration_number?: string | null
          role?: string | null
          section_code?: string | null
          section_name?: string | null
          status?: string
          termination_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          billing_month: string | null
          competence_month: string | null
          created_at: string
          first_due_month: string | null
          id: string
          notes: string | null
          service_reference_month: string | null
          source_file_hash: string | null
          source_file_name: string | null
          source_file_storage_path: string | null
          source_type: string
          status: string
          total_amount_cents: number | null
          total_charged_company_cents: number | null
          total_items: number | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          billing_month?: string | null
          competence_month?: string | null
          created_at?: string
          first_due_month?: string | null
          id?: string
          notes?: string | null
          service_reference_month?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_file_storage_path?: string | null
          source_type?: string
          status?: string
          total_amount_cents?: number | null
          total_charged_company_cents?: number | null
          total_items?: number | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          billing_month?: string | null
          competence_month?: string | null
          created_at?: string
          first_due_month?: string | null
          id?: string
          notes?: string | null
          service_reference_month?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_file_storage_path?: string | null
          source_type?: string
          status?: string
          total_amount_cents?: number | null
          total_charged_company_cents?: number | null
          total_items?: number | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      import_items: {
        Row: {
          amount_cents: number | null
          created_at: string
          id: string
          import_batch_id: string
          match_confidence: number | null
          match_status: string | null
          matched_employee_id: string | null
          notes: string | null
          raw_employee_identifier: string | null
          raw_employee_name: string | null
          raw_text_reference: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          id?: string
          import_batch_id: string
          match_confidence?: number | null
          match_status?: string | null
          matched_employee_id?: string | null
          notes?: string | null
          raw_employee_identifier?: string | null
          raw_employee_name?: string | null
          raw_text_reference?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          id?: string
          import_batch_id?: string
          match_confidence?: number | null
          match_status?: string | null
          matched_employee_id?: string | null
          notes?: string | null
          raw_employee_identifier?: string | null
          raw_employee_name?: string | null
          raw_text_reference?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_items_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_matched_employee_id_fkey"
            columns: ["matched_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plan_items: {
        Row: {
          competence_month: string | null
          created_at: string
          due_month: string
          employee_id: string
          id: string
          installment_count: number
          installment_number: number
          installment_plan_id: string
          scheduled_amount_cents: number
          status: string
          updated_at: string
        }
        Insert: {
          competence_month?: string | null
          created_at?: string
          due_month: string
          employee_id: string
          id?: string
          installment_count: number
          installment_number: number
          installment_plan_id: string
          scheduled_amount_cents: number
          status?: string
          updated_at?: string
        }
        Update: {
          competence_month?: string | null
          created_at?: string
          due_month?: string
          employee_id?: string
          id?: string
          installment_count?: number
          installment_number?: number
          installment_plan_id?: string
          scheduled_amount_cents?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plan_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plan_items_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          created_at: string
          employee_id: string
          first_due_month: string
          id: string
          installment_count: number
          monthly_usage_id: string | null
          notes: string | null
          rule_version: string | null
          source_type: string
          status: string
          total_amount_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          first_due_month: string
          id?: string
          installment_count: number
          monthly_usage_id?: string | null
          notes?: string | null
          rule_version?: string | null
          source_type: string
          status?: string
          total_amount_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          first_due_month?: string
          id?: string
          installment_count?: number
          monthly_usage_id?: string | null
          notes?: string | null
          rule_version?: string | null
          source_type?: string
          status?: string
          total_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_monthly_usage_id_fkey"
            columns: ["monthly_usage_id"]
            isOneToOne: false
            referencedRelation: "monthly_usage"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_usage: {
        Row: {
          amount_cents: number
          competence_month: string
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          source_reference_id: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          competence_month: string
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          source_reference_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          competence_month?: string
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          source_reference_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_usage_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_export_items: {
        Row: {
          amount_to_deduct_cents: number
          carryover_in_cents: number | null
          carryover_out_cents: number | null
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          payroll_export_id: string
          payroll_month: string
        }
        Insert: {
          amount_to_deduct_cents: number
          carryover_in_cents?: number | null
          carryover_out_cents?: number | null
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          payroll_export_id: string
          payroll_month: string
        }
        Update: {
          amount_to_deduct_cents?: number
          carryover_in_cents?: number | null
          carryover_out_cents?: number | null
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          payroll_export_id?: string
          payroll_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_export_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_export_items_payroll_export_id_fkey"
            columns: ["payroll_export_id"]
            isOneToOne: false
            referencedRelation: "payroll_exports"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_exports: {
        Row: {
          created_at: string
          file_storage_path: string | null
          generated_at: string
          generated_by: string | null
          id: string
          layout_version: string | null
          notes: string | null
          payroll_month: string
          status: string
          total_amount_cents: number | null
          total_employees: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_storage_path?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          layout_version?: string | null
          notes?: string | null
          payroll_month: string
          status?: string
          total_amount_cents?: number | null
          total_employees?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_storage_path?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          layout_version?: string | null
          notes?: string | null
          payroll_month?: string
          status?: string
          total_amount_cents?: number | null
          total_employees?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      payroll_monthly_ledger: {
        Row: {
          amount_to_deduct_cents: number
          cap_cents: number
          carryover_in_cents: number
          carryover_out_cents: number
          closed_at: string | null
          created_at: string
          employee_id: string
          export_id: string | null
          exported_at: string | null
          gross_due_cents: number
          id: string
          payroll_month: string
          scheduled_amount_cents: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_to_deduct_cents?: number
          cap_cents?: number
          carryover_in_cents?: number
          carryover_out_cents?: number
          closed_at?: string | null
          created_at?: string
          employee_id: string
          export_id?: string | null
          exported_at?: string | null
          gross_due_cents?: number
          id?: string
          payroll_month: string
          scheduled_amount_cents?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_to_deduct_cents?: number
          cap_cents?: number
          carryover_in_cents?: number
          carryover_out_cents?: number
          closed_at?: string | null
          created_at?: string
          employee_id?: string
          export_id?: string | null
          exported_at?: string | null
          gross_due_cents?: number
          id?: string
          payroll_month?: string
          scheduled_amount_cents?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_monthly_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "rh" | "leitura"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "rh", "leitura"],
    },
  },
} as const

// ============================================================
// Types de la base AGRO ELITE — écrits à la main (compatibles Supabase)
// ============================================================
// Reproduit la forme de `supabase gen types typescript`. Quand tu installeras
// la CLI plus tard, régénère pour récupérer les Relationships complètes (joins
// typés) ; les requêtes simples sont déjà entièrement typées ici.
// NB : montants en FCFA (code ISO 'XOF') = number entiers ; dates = string (ISO 'YYYY-MM-DD').

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Timestamps = {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slogan: string | null;
          logo_url: string | null;
          color_primary: string;
          currency: string;
        } & Timestamps;
        Insert: {
          id?: string;
          name: string;
          slogan?: string | null;
          logo_url?: string | null;
          color_primary?: string;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slogan?: string | null;
          logo_url?: string | null;
          color_primary?: string;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          org_id: string;
          full_name: string | null;
          role: Database['public']['Enums']['user_role'];
        } & Timestamps;
        Insert: {
          id: string;
          org_id: string;
          full_name?: string | null;
          role?: Database['public']['Enums']['user_role'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          full_name?: string | null;
          role?: Database['public']['Enums']['user_role'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      species: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          category: string | null;
          attributes: Json;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          category?: string | null;
          attributes?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          category?: string | null;
          attributes?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          org_id: string;
          species_id: string | null;
          name: string;
          unit: string;
          default_price: number;
          attributes: Json;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          species_id?: string | null;
          name: string;
          unit?: string;
          default_price?: number;
          attributes?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          species_id?: string | null;
          name?: string;
          unit?: string;
          default_price?: number;
          attributes?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      lots: {
        Row: {
          id: string;
          org_id: string;
          species_id: string;
          code: string;
          start_date: string;
          initial_count: number;
          current_count: number;
          status: Database['public']['Enums']['lot_status'];
          notes: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          species_id: string;
          code: string;
          start_date?: string;
          initial_count?: number;
          current_count?: number;
          status?: Database['public']['Enums']['lot_status'];
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          species_id?: string;
          code?: string;
          start_date?: string;
          initial_count?: number;
          current_count?: number;
          status?: Database['public']['Enums']['lot_status'];
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      production_records: {
        Row: {
          id: string;
          org_id: string;
          lot_id: string | null;
          product_id: string;
          day: string;
          quantity: number;
          category: Database['public']['Enums']['production_category'];
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          lot_id?: string | null;
          product_id: string;
          day?: string;
          quantity?: number;
          category?: Database['public']['Enums']['production_category'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          lot_id?: string | null;
          product_id?: string;
          day?: string;
          quantity?: number;
          category?: Database['public']['Enums']['production_category'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      incubation_batches: {
        Row: {
          id: string;
          org_id: string;
          species_id: string | null;
          source_lot_id: string | null;
          result_lot_id: string | null;
          set_date: string;
          expected_hatch: string | null;
          eggs_count: number;
          hatched_count: number | null;
          status: string;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          species_id?: string | null;
          source_lot_id?: string | null;
          result_lot_id?: string | null;
          set_date?: string;
          expected_hatch?: string | null;
          eggs_count?: number;
          hatched_count?: number | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          species_id?: string | null;
          source_lot_id?: string | null;
          result_lot_id?: string | null;
          set_date?: string;
          expected_hatch?: string | null;
          eggs_count?: number;
          hatched_count?: number | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      health_records: {
        Row: {
          id: string;
          org_id: string;
          lot_id: string;
          day: string;
          type: Database['public']['Enums']['health_type'];
          description: string | null;
          affected_count: number;
          cost: number;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          lot_id: string;
          day?: string;
          type: Database['public']['Enums']['health_type'];
          description?: string | null;
          affected_count?: number;
          cost?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          lot_id?: string;
          day?: string;
          type?: Database['public']['Enums']['health_type'];
          description?: string | null;
          affected_count?: number;
          cost?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      stock_items: {
        Row: {
          id: string;
          org_id: string;
          product_id: string | null;
          name: string;
          type: Database['public']['Enums']['stock_type'];
          unit: string;
          quantity: number;
          reorder_threshold: number;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          product_id?: string | null;
          name: string;
          type: Database['public']['Enums']['stock_type'];
          unit?: string;
          quantity?: number;
          reorder_threshold?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          product_id?: string | null;
          name?: string;
          type?: Database['public']['Enums']['stock_type'];
          unit?: string;
          quantity?: number;
          reorder_threshold?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          id: string;
          org_id: string;
          stock_item_id: string;
          lot_id: string | null;
          day: string;
          direction: Database['public']['Enums']['stock_direction'];
          quantity: number;
          cost: number;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          stock_item_id: string;
          lot_id?: string | null;
          day?: string;
          direction: Database['public']['Enums']['stock_direction'];
          quantity?: number;
          cost?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          stock_item_id?: string;
          lot_id?: string | null;
          day?: string;
          direction?: Database['public']['Enums']['stock_direction'];
          quantity?: number;
          cost?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          phone: string | null;
          notes: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          org_id: string;
          customer_id: string | null;
          day: string;
          total: number;
          payment_method: Database['public']['Enums']['payment_method'];
          status: string;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          customer_id?: string | null;
          day?: string;
          total?: number;
          payment_method?: Database['public']['Enums']['payment_method'];
          status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          customer_id?: string | null;
          day?: string;
          total?: number;
          payment_method?: Database['public']['Enums']['payment_method'];
          status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      sale_items: {
        Row: {
          id: string;
          org_id: string;
          sale_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          sale_id: string;
          product_id: string;
          quantity?: number;
          unit_price?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          sale_id?: string;
          product_id?: string;
          quantity?: number;
          unit_price?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          org_id: string;
          lot_id: string | null;
          stock_item_id: string | null;
          day: string;
          category: string;
          amount: number;
          supplier: string | null;
          payment_method: Database['public']['Enums']['payment_method'];
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          lot_id?: string | null;
          stock_item_id?: string | null;
          day?: string;
          category: string;
          amount?: number;
          supplier?: string | null;
          payment_method?: Database['public']['Enums']['payment_method'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          lot_id?: string | null;
          stock_item_id?: string | null;
          day?: string;
          category?: string;
          amount?: number;
          supplier?: string | null;
          payment_method?: Database['public']['Enums']['payment_method'];
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      goals: {
        Row: {
          id: string;
          org_id: string;
          metric: string;
          target_value: number;
          period: string | null;
          start_date: string | null;
          end_date: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          org_id: string;
          metric: string;
          target_value: number;
          period?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          metric?: string;
          target_value?: number;
          period?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      v_lot_overview: {
        Row: {
          lot_id: string | null;
          org_id: string | null;
          code: string | null;
          status: Database['public']['Enums']['lot_status'] | null;
          initial_count: number | null;
          current_count: number | null;
          total_produit: number | null;
          depenses_directes: number | null;
          cout_intrants: number | null;
          cout_sante: number | null;
          cout_total: number | null;
        };
        Relationships: [];
      };
      v_financial_summary: {
        Row: {
          org_id: string | null;
          mois: string | null;
          revenus: number | null;
          depenses: number | null;
          benefice: number | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      payment_method: 'cash' | 'wave' | 'orange_money' | 'autre';
      production_category: 'ponte' | 'casse' | 'consomme' | 'recolte';
      stock_type: 'aliment' | 'medicament' | 'emballage' | 'produit_fini';
      stock_direction: 'entree' | 'sortie';
      health_type: 'maladie' | 'traitement' | 'vaccin' | 'mortalite';
      lot_status: 'actif' | 'vendu' | 'termine';
      user_role: 'proprietaire' | 'superviseur';
    };
    CompositeTypes: Record<string, never>;
  };
}

// Raccourcis pratiques
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Views<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
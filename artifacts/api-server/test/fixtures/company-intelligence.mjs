export const source = {
  source_id: "SRC-001", source_type: "company_website", title: "Research fixture company",
  url: "https://example.com/fixture", publisher: "example.com", published_date: "2026-01-15",
  accessed_at: "2026-10-07T00:00:00.000Z", reliability: "high",
};
export function profileFixture() {
  return {
    executive_summary: { one_liner: "Evidence-backed analytics services.", business_summary: "", key_observations: [] },
    company_profile: { industry: "", sub_industry: "", company_type: "", founded_year: null, headquarters: "", operating_regions: [], employee_range: "", revenue_range: "", ownership: "", parent_company: "" },
    business: { business_model: "", products_services: [], customer_segments: [], key_markets: [], business_units: [], competitive_position: "" },
    technology: { erp: [], crm: [], hrms: [], lms: [], scm: [], procurement: [], inventory: [], cloud: [], data_platforms: [], ai_platforms: [], other: [] },
    current_signals: [{
      signal_id: "fixture-event", type: "product_launch", title: "Dated fixture launch", description: "A launch supported by the fixture evidence.",
      event_date: "2026-01-15", source_published_date: "2026-01-15", observed_at: "2026-10-07T00:00:00.000Z",
      importance: "medium", sales_relevance: ["Potential analytics conversation"], confidence: 0.8, source_ids: ["SRC-001"],
    }],
    opportunity_signals: [{
      opportunity_id: "fixture-opportunity", type: "growth_opportunity", statement: "An analytics discussion may be relevant.",
      basis: ["Dated product launch"], confidence: 0.5, generated_at: "2026-10-07T00:00:00.000Z", source_ids: ["SRC-001"],
    }],
    sales_intelligence: { buying_signals: [], potential_pain_points: [], digital_transformation_signals: [], growth_signals: [], risk_signals: [] },
    competitors: [], fact_sources: [{ path: "executive_summary.one_liner", confidence: 0.8, source_ids: ["SRC-001"] }], conflicts: [], sources: [source],
  };
}

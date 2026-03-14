import { GoogleGenAI, Type } from '@google/genai';
import { Tenant, Landlord, MatchResult, InventoryItem } from '../types';

// Use the Stuhelper key if provided in secrets, otherwise fallback to GEMINI_API_KEY
const apiKey = process.env.Stuhelper || process.env.stuhelper || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey as string });

export async function matchTenantWithLandlords(tenant: Tenant, landlords: Landlord[]): Promise<MatchResult[]> {
  const prompt = `
    You are an expert real estate AI assistant. Your task is to match a tenant with a list of available properties from landlords.
    
    Tenant Details:
    - Name: ${tenant.fullName}
    - Budget: ${tenant.monthlyBudget}
    - Location Preference: ${tenant.preferredLocation} (City: ${tenant.city})
    - BHK Preference: ${tenant.roomPreference}
    - Furnishing: ${tenant.furnishingStatus}
    - Floor Preference: ${tenant.floorPreference}
    - Client Type: ${tenant.clientType} (${tenant.numberOfMembers} members)
    - Priorities (1-5 scale): ${tenant.priorities ? `Budget: ${tenant.priorities.budget}, Location: ${tenant.priorities.location}, BHK: ${tenant.priorities.bhk}, Furnishing: ${tenant.priorities.furnishing}` : 'Not specified'}
    
    Available Properties:
    ${landlords.map(l => `
      ID: ${l.id}
      - Location: ${l.propertyAddress}
      - Rent: ${l.rentPrice}
      - Configuration: ${l.configuration}
      - Furnishing: ${l.furnishingStatus}
      - Floor: ${l.floorNumber}
      - Description: ${l.propertyDescription}
    `).join('\n')}
    
    Analyze the tenant's requirements against each property. Provide a match score from 0 to 100 for each property, and a detailed reasoning (3-4 sentences) for why it is a good or bad match, explicitly highlighting specific property features that align well with the tenant's priorities and potential areas of concern for the tenant.
    Also provide a list of specific 'alignments' (requirements that match perfectly) and 'contradictions' (requirements that do not match).
    Consider budget, location, configuration, and furnishing status as the most important factors.
    IMPORTANT RULE: Only properties with 2 or fewer contradictions will be shown to the user. 
    STRICT RULE: If a property contradicts the tenant's preference in any of these 4 areas, it MUST be rejected:
    1. Location
    2. Budget (Rent must NOT exceed tenant's budget by more than 30%)
    3. Client Type (Boys/Girls/Couple/Family)
    4. Room/BHK Preference
    Try to find the best matches that satisfy this.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              landlordId: {
                type: Type.STRING,
                description: "The ID of the landlord/property"
              },
              matchScore: {
                type: Type.NUMBER,
                description: "A score from 0 to 100 indicating how well the property matches the tenant's requirements"
              },
              reasoning: {
                type: Type.STRING,
                description: "A brief reasoning for the match score"
              },
              alignments: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that align with the property features"
              },
              contradictions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that contradict or do not match the property features"
              }
            },
            required: ["landlordId", "matchScore", "reasoning", "alignments", "contradictions"]
          }
        }
      }
    });

    const results = JSON.parse(response.text || '[]');
    return results
      .map((r: any) => ({
        tenantId: tenant.id,
        landlordId: r.landlordId,
        matchScore: r.matchScore,
        reasoning: r.reasoning,
        alignments: r.alignments || [],
        contradictions: r.contradictions || [],
        source: 'Property Listing'
      }))
      .filter((r: MatchResult) => {
        const hasStrictContradiction = r.contradictions.some(c => 
          c.toLowerCase().includes('location') || 
          c.toLowerCase().includes('budget') || 
          c.toLowerCase().includes('client type') || 
          c.toLowerCase().includes('bhk') || 
          c.toLowerCase().includes('room') ||
          c.toLowerCase().includes('configuration')
        );
        return r.contradictions.length <= 2 && !hasStrictContradiction;
      })
      .sort((a: MatchResult, b: MatchResult) => b.matchScore - a.matchScore);
  } catch (error) {
    console.error("Error matching with AI:", error);
    return [];
  }
}

export async function matchLandlordWithTenants(landlord: Landlord, tenants: Tenant[], source: 'Property Listing' | 'Complete Inventory' = 'Property Listing'): Promise<MatchResult[]> {
  const prompt = `
    You are an expert real estate AI assistant. Your task is to match an available property with a list of potential tenants.
    
    Property Details:
    - Location: ${landlord.propertyAddress}
    - Rent: ${landlord.rentPrice}
    - Configuration: ${landlord.configuration}
    - Furnishing: ${landlord.furnishingStatus}
    - Floor: ${landlord.floorNumber}
    - Description: ${landlord.propertyDescription}
    
    Potential Tenants:
    ${tenants.map(t => `
      ID: ${t.id}
      - Budget: ${t.monthlyBudget}
      - Location Preference: ${t.preferredLocation} (City: ${t.city})
      - BHK Preference: ${t.roomPreference}
      - Furnishing: ${t.furnishingStatus}
      - Floor Preference: ${t.floorPreference}
      - Client Type: ${t.clientType} (${t.numberOfMembers} members)
    `).join('\n')}
    
    Analyze the property's features against each tenant's requirements. Provide a match score from 0 to 100 for each tenant, and a detailed reasoning (3-4 sentences) for why it is a good or bad match, explicitly highlighting specific property features that align well with the tenant's priorities and potential areas of concern for the tenant.
    Also provide a list of specific 'alignments' (requirements that match perfectly) and 'contradictions' (requirements that do not match).
    Consider budget, location, configuration, and furnishing status as the most important factors.
    IMPORTANT RULE: Only matches with 2 or fewer contradictions will be shown to the user. 
    STRICT RULE: If a match contradicts the tenant's preference in any of these 4 areas, it MUST be rejected:
    1. Location
    2. Budget (Rent must NOT exceed tenant's budget by more than 30%)
    3. Client Type (Boys/Girls/Couple/Family)
    4. Room/BHK Preference
    Try to find the best matches that satisfy this.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tenantId: {
                type: Type.STRING,
                description: "The ID of the tenant"
              },
              matchScore: {
                type: Type.NUMBER,
                description: "A score from 0 to 100 indicating how well the tenant matches the property"
              },
              reasoning: {
                type: Type.STRING,
                description: "A brief reasoning for the match score"
              },
              alignments: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that align with the property features"
              },
              contradictions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that contradict or do not match the property features"
              }
            },
            required: ["tenantId", "matchScore", "reasoning", "alignments", "contradictions"]
          }
        }
      }
    });

    const results = JSON.parse(response.text || '[]');
    return results
      .map((r: any) => ({
        tenantId: r.tenantId,
        landlordId: landlord.id,
        matchScore: r.matchScore,
        reasoning: r.reasoning,
        alignments: r.alignments || [],
        contradictions: r.contradictions || [],
        source
      }))
      .filter((r: MatchResult) => {
        const hasStrictContradiction = r.contradictions.some(c => 
          c.toLowerCase().includes('location') || 
          c.toLowerCase().includes('budget') || 
          c.toLowerCase().includes('client type') || 
          c.toLowerCase().includes('bhk') || 
          c.toLowerCase().includes('room') ||
          c.toLowerCase().includes('configuration')
        );
        return r.contradictions.length <= 2 && !hasStrictContradiction;
      })
      .sort((a: MatchResult, b: MatchResult) => b.matchScore - a.matchScore);
  } catch (error) {
    console.error("Error matching with AI:", error);
    return [];
  }
}

export async function matchTenantWithInventory(tenant: Tenant, inventory: InventoryItem[]): Promise<MatchResult[]> {
  const prompt = `
    You are an expert real estate AI assistant. Your task is to match a tenant with a list of available properties from the complete inventory.
    
    Tenant Details:
    - Name: ${tenant.fullName}
    - Budget: ${tenant.monthlyBudget}
    - Location Preference: ${tenant.preferredLocation} (City: ${tenant.city})
    - BHK Preference: ${tenant.roomPreference}
    - Furnishing: ${tenant.furnishingStatus}
    - Floor Preference: ${tenant.floorPreference}
    - Client Type: ${tenant.clientType} (${tenant.numberOfMembers} members)
    - Priorities (1-5 scale): ${tenant.priorities ? `Budget: ${tenant.priorities.budget}, Location: ${tenant.priorities.location}, BHK: ${tenant.priorities.bhk}, Furnishing: ${tenant.priorities.furnishing}` : 'Not specified'}
    
    Inventory Properties:
    ${inventory.map(item => `
      ID: ${item.id}
      - Sector: ${item.sector}
      - Plot ID: ${item.plotId}
      - Rent: ${item.rent}
      - Configuration: ${item.roomCount}
      - Furnishing: ${item.statusFurnishing}
      - Floor: ${item.floorLevel}
      - Area: ${item.propertyArea}
    `).join('\n')}
    
    Analyze the tenant's requirements against each property. Provide a match score from 0 to 100 for each property, and a detailed reasoning (3-4 sentences) for why it is a good or bad match, explicitly highlighting specific property features that align well with the tenant's priorities and potential areas of concern for the tenant.
    Also provide a list of specific 'alignments' (requirements that match perfectly) and 'contradictions' (requirements that do not match).
    Consider budget, location, configuration, and furnishing status as the most important factors.
    IMPORTANT RULE: Only properties with 2 or fewer contradictions will be shown to the user. 
    STRICT RULE: If a property contradicts the tenant's preference in any of these 4 areas, it MUST be rejected:
    1. Location
    2. Budget (Rent must NOT exceed tenant's budget by more than 30%)
    3. Client Type (Boys/Girls/Couple/Family)
    4. Room/BHK Preference
    Try to find the best matches that satisfy this.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              inventoryId: {
                type: Type.STRING,
                description: "The ID of the inventory item"
              },
              matchScore: {
                type: Type.NUMBER,
                description: "A score from 0 to 100 indicating how well the property matches the tenant's requirements"
              },
              reasoning: {
                type: Type.STRING,
                description: "A brief reasoning for the match score"
              },
              alignments: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that align with the property features"
              },
              contradictions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of specific tenant requirements that contradict or do not match the property features"
              }
            },
            required: ["inventoryId", "matchScore", "reasoning", "alignments", "contradictions"]
          }
        }
      }
    });

    const results = JSON.parse(response.text || '[]');
    return results
      .map((r: any) => ({
        tenantId: tenant.id,
        landlordId: r.inventoryId,
        matchScore: r.matchScore,
        reasoning: r.reasoning,
        alignments: r.alignments || [],
        contradictions: r.contradictions || [],
        source: 'Complete Inventory'
      }))
      .filter((r: MatchResult) => {
        const hasStrictContradiction = r.contradictions.some(c => 
          c.toLowerCase().includes('location') || 
          c.toLowerCase().includes('budget') || 
          c.toLowerCase().includes('client type') || 
          c.toLowerCase().includes('bhk') || 
          c.toLowerCase().includes('room') ||
          c.toLowerCase().includes('configuration')
        );
        return r.contradictions.length <= 2 && !hasStrictContradiction;
      })
      .sort((a: MatchResult, b: MatchResult) => b.matchScore - a.matchScore);
  } catch (error) {
    console.error("Error matching with AI (Inventory):", error);
    return [];
  }
}

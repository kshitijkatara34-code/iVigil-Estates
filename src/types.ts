export interface Tenant {
  id: string;
  timestamp: string;
  mobileNumber: string;
  fullName: string;
  roomPreference: string;
  monthlyBudget: string;
  furnishingStatus: string;
  preferredLocation: string;
  exactShiftingDate: string;
  city: string;
  designation: string;
  workProfile: string;
  clientType: string;
  numberOfMembers: string;
  floorPreference: string;
  hometown: string;
  emailAddress: string;
  priorities?: {
    budget: number;
    location: number;
    bhk: number;
    furnishing: number;
  };
}

export interface Landlord {
  id: string;
  timestamp: string;
  buildingType: string;
  forStatus: string;
  propertyType: string;
  areaDetails: string;
  furnishingStatus: string;
  propertyDescription: string;
  floorNumber: string;
  ownerName: string;
  contactNumber: string;
  propertyAddress: string;
  configuration: string;
  rentPrice: string;
  images: string;
  videos: string;
  email: string;
}

export interface InventoryItem {
  id: string;
  sector: string;
  plotId: string;
  propertyArea: string;
  floorLevel: string;
  roomCount: string;
  statusFurnishing: string;
  rent: string;
  ownerName: string;
  phoneNumber: string;
  availability: string;
}

export interface MatchResult {
  tenantId: string;
  landlordId: string;
  matchScore: number;
  reasoning: string;
  alignments?: string[];
  contradictions?: string[];
  source?: 'Property Listing' | 'Complete Inventory';
}

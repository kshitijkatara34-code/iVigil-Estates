import Papa from 'papaparse';
import { Tenant, Landlord, InventoryItem } from '../types';

const TENANTS_URL = 'https://docs.google.com/spreadsheets/d/1ccTNwr6N-RNITHHY1sWcKt-cBGEF0ngRu9b7An3qRqc/export?format=csv';
const LANDLORDS_URL = 'https://docs.google.com/spreadsheets/d/1pOieA2CEp9x-Yuu7mVY34dVmz32KZjIJyd0peH3TEuQ/export?format=csv';
const INVENTORY_GIDS = [
  '1148564728', // Residential for Sale (South Delhi)
  '447945408',  // Commercial for Rent (Gurgaon)
  '684603941',  // Resident for Rent (Gurgaon)
  '0',          // Resident for Rent (South Delhi)
  '1366245239', // Residential for Sale (Noida)
  '1310656180', // Comm. sale Gurgaon
  '786012529',  // Residential for Rent (Noida)
  '1422195848', // Commercial Rent (Noida)
  '252349026'   // Listing(27
];

const INVENTORY_BASE_URL = 'https://docs.google.com/spreadsheets/d/1w_oZ1XuU3PQrcaacMK1oSx8_8WiZR0ysPzrkpq1VMkM/export?format=csv&gid=';

export async function fetchInventory(): Promise<InventoryItem[]> {
  const fetchPromises = INVENTORY_GIDS.map(gid => {
    return new Promise<InventoryItem[]>((resolve, reject) => {
      Papa.parse(`${INVENTORY_BASE_URL}${gid}&_=${new Date().getTime()}`, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const inventory = results.data
            .map((row: any, index: number) => {
              // Extract values using possible column names across different sheets
              const sector = row['Sector'] || row['Locality'] || '';
              const plotId = row['Plot/ID'] || row['Plot ID'] || row['Property No'] || '';
              const propertyArea = row['Property Area'] || row['Area'] || '';
              const floorLevel = row['Floor Level'] || row['Floor '] || row['Floor'] || '';
              const roomCount = row['Room Count'] || row['Rooms '] || row['Rooms'] || '';
              const statusFurnishing = row['Status/Furnishing'] || row['Features/Remarks'] || '';
              const rent = row['Rent (₹)'] || row['Rent'] || row['Price'] || '';
              const ownerName = row['Owner/Contact'] || row['Contact Name'] || '';
              const phoneNumber = row['Phone Number'] || row['Contact Number'] || '';
              const availability = row['Availability'] || row['Availability '] || '';

              if (!sector && !plotId && !phoneNumber) return null; // Skip completely empty rows

              return {
                id: `inv_${gid}_${index}`,
                sector,
                plotId,
                propertyArea,
                floorLevel,
                roomCount,
                statusFurnishing,
                rent,
                ownerName,
                phoneNumber,
                availability,
              };
            })
            .filter(Boolean) as InventoryItem[];
            
          resolve(inventory);
        },
        error: (error) => {
          console.error(`Error fetching gid ${gid}:`, error);
          resolve([]); // Resolve empty array on error to not break Promise.all
        }
      });
    });
  });

  const results = await Promise.all(fetchPromises);
  return results.flat();
}

export async function fetchTenants(): Promise<Tenant[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(`${TENANTS_URL}&_=${new Date().getTime()}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const tenants = results.data
          .filter((row: any) => row['Mobile Number'] && row['Mobile Number'].trim() !== '')
          .map((row: any, index: number) => ({
            id: `t_${index}`,
          timestamp: row['Timestamp'] || '',
          mobileNumber: row['Mobile Number'] || '',
          fullName: row['Full Name'] || '',
          roomPreference: row['Room/BHK Prefrence'] || '',
          monthlyBudget: row['Monthly Budget'] || '',
          furnishingStatus: row['Furnishing Status'] || '',
          preferredLocation: row['Preferred Location'] || '',
          exactShiftingDate: row['Exact Shifting Date'] || '',
          city: row['City'] || '',
          designation: row['Designation'] || '',
          workProfile: row['Work Profile'] || '',
          clientType: row['Client Type'] || '',
          numberOfMembers: row['Number of Members'] || '',
          floorPreference: row['Floor Preference'] || '',
          hometown: row['Hometown'] || '',
          emailAddress: row['Email Address'] || '',
        }));
        resolve(tenants);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}

export async function fetchLandlords(): Promise<Landlord[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(`${LANDLORDS_URL}&_=${new Date().getTime()}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const landlords = results.data
          .filter((row: any) => row['Contact Number'] && row['Contact Number'].trim() !== '')
          .map((row: any, index: number) => ({
            id: `l_${index}`,
          timestamp: row['Timestamp'] || '',
          buildingType: row['BuildingType'] || '',
          forStatus: row['For '] || '',
          propertyType: row['Property Type '] || '',
          areaDetails: row['Area Details Sqft/Sqyd'] || '',
          furnishingStatus: row['Furnishing Status'] || '',
          propertyDescription: row['Property Description'] || '',
          floorNumber: row['Foor Number'] || '',
          ownerName: row['Owner Name'] || '',
          contactNumber: row['Contact Number'] || '',
          propertyAddress: row['Full Property Address / Society Name'] || '',
          configuration: row['Configuration (BHK)'] || '',
          rentPrice: row['Rent Price /Sale Price (₹)'] || '',
          images: row['Add images of property/ share on Whatsapp on same number.'] || '',
          videos: row['Add videos of property'] || '',
          email: row['Email : '] || '',
        }));
        resolve(landlords);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}

/** EKOTRACE SME: every SME screen under /sme/<page>, sharing one data store. */
import { Navigate, Route, Routes } from 'react-router-dom';
import './sme.css';
import { SmeProvider } from './store';
import { SmeHome } from './Home';
import { SmeEmissions } from './Emissions';
import { SmeProfile } from './Profile';
import { SmeApplies } from './Applies';
import { SmeEsg } from './Esg';
import { SmeSrmm } from './Srmm';
import { SmeFootprint } from './Footprint';
import { SmeCerts } from './Certs';
import { SmeBills } from './Bills';
import { SmeSolar } from './Solar';
import { SmeSchemes } from './Schemes';
import { SmeScrap } from './Scrap';
import { SmeCredits } from './Credits';
import { SmeCalendar } from './Calendar';
import { SmeEpr } from './Epr';
import { SmeDpdp } from './Dpdp';
import { SmePeople } from './People';
import { SmeCsr } from './Csr';
import { SmeCbam } from './Cbam';
import { SmeEudr } from './Eudr';
import { SmeScan } from './Scan';
import { SmeQuestionnaire } from './Questionnaire';
import { SmeWhatsapp } from './Whatsapp';
import { SmeShare } from './Share';
import { SmeLoan } from './Loan';

export function SmeApp() {
  return (
    <SmeProvider>
      <div className="page sme">
        <Routes>
        <Route path="home" element={<SmeHome />} />
        <Route path="emissions" element={<SmeEmissions />} />
        <Route path="profile" element={<SmeProfile />} />
        <Route path="applies" element={<SmeApplies />} />
        <Route path="esg" element={<SmeEsg />} />
        <Route path="srmm" element={<SmeSrmm />} />
        <Route path="footprint" element={<SmeFootprint />} />
        <Route path="certs" element={<SmeCerts />} />
        <Route path="bills" element={<SmeBills />} />
        <Route path="solar" element={<SmeSolar />} />
        <Route path="schemes" element={<SmeSchemes />} />
        <Route path="scrap" element={<SmeScrap />} />
        <Route path="credits" element={<SmeCredits />} />
        <Route path="calendar" element={<SmeCalendar />} />
        <Route path="epr" element={<SmeEpr />} />
        <Route path="dpdp" element={<SmeDpdp />} />
        <Route path="people" element={<SmePeople />} />
        <Route path="csr" element={<SmeCsr />} />
        <Route path="cbam" element={<SmeCbam />} />
        <Route path="eudr" element={<SmeEudr />} />
        <Route path="scan" element={<SmeScan />} />
        <Route path="questionnaire" element={<SmeQuestionnaire />} />
        <Route path="whatsapp" element={<SmeWhatsapp />} />
        <Route path="share" element={<SmeShare />} />
        <Route path="loan" element={<SmeLoan />} />
        <Route path="*" element={<Navigate to="/sme/home" replace />} />
        </Routes>
      </div>
    </SmeProvider>);
}

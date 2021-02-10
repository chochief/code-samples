import { Injectable } from "@angular/core";
import {
  ContingentAreaApiConnector,
  ErzApiConnector,
  ResourcesApiConnector,
  RmrApiConnector,
  RmuApiConnector,
  Supd2CallApiConnector,
} from "@emias-cto/api/connectors";
import { catchError, map, switchMap } from "rxjs/operators";
import { forkJoin, Observable, of } from "rxjs";
import loadAllPages from "../../../modules/utils/load-all-pages";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ShortListInfo2Dto } from "../../../../../../../libs/api/connectors/src/lib/models/medorgsregisterservicetypes/_1/short-list-info-2-dto";
import { AreaShortDto } from "../../../../../../../libs/api/connectors/src/lib/models/contingent/v3._public.area/area-short-dto";
import {
  VisitStatus,
  VisitStatusKey,
} from "../components/grid-controls/visit-status-tag/visit-status-tag.component";
import { parseSupd2ErrorResponse } from "../../../modules/api-utils/supd2/supd2.error-parser";
import { LuMessageService } from "@solit/lucidus";
import { DEFAULT_REQUESTER_SYSTEM_CODE_FOR_CTO } from "../../medical-facilities/services/medical-facility-search.service";
import { parseRmuErrorResponse } from "../../../modules/api-utils/rmu/rmu.error-parser";
import { BusinessError } from "@emias-cto/errors";
import {
  parseErzErrorResponse,
  parseRirErrorResponse,
} from "@emias-cto/api/utils";
import { fullname } from "../../../modules/utils/pipes/fullname.pipe";
import { parseContingentAreaErrorResponse } from "../../../modules/api-utils/contingent-area/contingent-area.error-parser";
import { CallCcDto as Supd2CallServiceV1TypesCallCcDto } from "../../../../../../../libs/api/connectors/src/lib/models/supd2/call_service.v1.types/call-cc-dto";
import { FindCallsCcRequestSearchOptionsDto } from "../../../../../../../libs/api/connectors/src/lib/models/supd2/call_service.v1.types/find-calls-cc-request-search-options-dto";
import { SortingOptionsDto as Supd2CoreV1SortingOptionsDto } from "../../../../../../../libs/api/connectors/src/lib/models/supd2/core.v1/sorting-options-dto";
import { PersonResponseTypeDto } from "../../../../../../../libs/api/connectors/src/lib/models/erz_structurs/person-response-type-dto";
import { Age } from "../../patients/domain/age";
import { ru } from "date-fns/locale";
import { GetEmployeePacketInfoRequest2EmployeeListDto as Medempregisterservicetypes1GetEmployeePacketInfoRequest2EmployeeListDto } from "../../../../../../../libs/api/connectors/src/lib/models/medempregisterservicetypes/_1/get-employee-packet-info-request-2-employee-list-dto";
import { GetEmployeePacketInfoRequest2JobListDto as Medempregisterservicetypes1GetEmployeePacketInfoRequest2JobListDto } from "../../../../../../../libs/api/connectors/src/lib/models/medempregisterservicetypes/_1/get-employee-packet-info-request-2-job-list-dto";

export interface VisitField {
  date?: Date;
  status?: VisitStatus;
}

export interface MoField {
  moName: string;
}

export interface RegistrationField {
  created: Date;
  author: string;
}

export interface PatientField {
  id: number;
  name: string;
  info: string;
}

export interface DoctorCallGridRow {
  callId: number;
  visit: VisitField;
  address: string;
  mo: MoField;
  registration: RegistrationField;
  executor?: string;
  patient?: PatientField;
  color?: string;
}

export type FetchDCGridResult =
  | { status: "success"; data: DoctorCallGridRow[] }
  | { status: "nothing"; message: string }
  | { status: "failure"; message: string };

const FETCH_DOCTOR_CALLS_ERROR =
  "При загрузке списка вызовов врача на дом произошла ошибка";
const FETCH_PATIENT_DC_NOTHING_MESSAGE =
  "У пациента отсутствуют вызовы врача на дом";
const FETCH_PROBLEM_DC_NOTHING_MESSAGE =
  "Проблемные вызовы врача на дом отсутствуют";
const FETCH_UNIDENTIFIED_NOTHING_MESSAGE =
  "По заданным параметрам поиска не найдено ни одного вызова врача на дом";
export const FETCH_UNIDENTIFIED_EMPTY_SEARCH_MESSAGE =
  "Найдите пациента по номеру телефона или адресу вызова";
const FETCH_MF_ERROR =
  "При загрузке информации о медучреждениях произошла ошибка";
const FETCH_AREA_ERROR =
  "При загрузке информации об участках обслуживания произошла ошибка";
const FETCH_PATIENTS_ERROR =
  "При загрузке информации о пациентах произошла ошибка";
const FETCH_EXECUTORS_ERROR =
  "При загрузке информации об исполнителях вызовов произошла ошибка";
const LPUS_NOT_FOUND_ERROR_CODE = "7";
const OPENED_CALLS_LIST = ["RECEIVED", "ACCEPTED", "ON_CORRECTION"];

export interface ExecutorsBundle {
  availableResourceIds: number[];
  jobIds: number[];
  employeeIds: number[];
}

export type ExecutorType = "availableResourceId" | "jobId" | "employeeId";

export interface Executor {
  id: number;
  type: ExecutorType;
  name: string;
}

interface FetchDoctorCallsBaseParams {
  needPatients: boolean;
  needExecutors: boolean;
  needVisitStatus: boolean;
  fetchErrorMessage: string;
  nothingMessage: string;
  searchOptions: FindCallsCcRequestSearchOptionsDto;
  sortingOptions?: Supd2CoreV1SortingOptionsDto;
}

interface ParseFindCallsParams {
  calls: Supd2CallServiceV1TypesCallCcDto[];
  mfs: ShortListInfo2Dto[];
  needPatients: boolean;
  needExecutors: boolean;
  needVisitStatus: boolean;
  patients?: PersonResponseTypeDto[];
  executors?: Executor[];
}

interface FetchEmployeePacketParams {
  employeeList?: Medempregisterservicetypes1GetEmployeePacketInfoRequest2EmployeeListDto;
  jobList?: Medempregisterservicetypes1GetEmployeePacketInfoRequest2JobListDto;
  executorType: "jobId" | "employeeId";
}

@Injectable({ providedIn: "root" })
export class DoctorCallsFetchService {
  constructor(
    private luMessageService: LuMessageService,
    private supd2Call: Supd2CallApiConnector,
    private rmu: RmuApiConnector,
    private contingentArea: ContingentAreaApiConnector,
    private resources: ResourcesApiConnector,
    private erz: ErzApiConnector,
    private rmr: RmrApiConnector
  ) {}

  private static mockFindCallsCC(): Observable<FetchDCGridResult> {
    return of({
      status: "success",
      data: [
        {
          callId: 123,
          mo: {
            moName: "МО 1234",
          },
          address: "г. Москва, Ленинградский проспект, д. 999, кв. 222",
          patient: {
            id: 123456,
            name: "Иванов Иван Иванович",
            info: "М, 143 года (2 октября 1877)",
          },
          visit: {
            date: parseISO("2020-12-01"),
          },
          registration: {
            created: parseISO("2020-12-01 08:45"),
            author: "Author",
          },
        },
      ],
    } as FetchDCGridResult);
  }

  private fetchDoctorCallsBase(
    params: FetchDoctorCallsBaseParams
  ): Observable<FetchDCGridResult> {
    // return DoctorCallsFetchService.mockFindCallsCC();
    const {
      needExecutors,
      needPatients,
      needVisitStatus,
      fetchErrorMessage,
      nothingMessage,
      searchOptions,
      sortingOptions,
    } = params;
    return this.loadAllFindCalls(searchOptions).pipe(
      switchMap((calls) => {
        const mfIds = DoctorCallsFetchService.parseMfIds(calls);
        const executorIds =
          needExecutors && DoctorCallsFetchService.parseExecutorIds(calls);
        const patientIds =
          needPatients && DoctorCallsFetchService.parsePatientIds(calls);
        return forkJoin([
          this.fetchMfs(mfIds),
          this.fetchExecutors(executorIds),
          this.fetchManyPatients(patientIds),
        ]).pipe(
          map((responses) => {
            const [mfs, executors, patients] = responses;
            const patientDoctorCalls = DoctorCallsFetchService.parseFindCalls({
              calls,
              mfs,
              needPatients,
              needExecutors,
              needVisitStatus,
              patients,
              executors,
            });
            return patientDoctorCalls.length
              ? ({
                  status: "success",
                  data: patientDoctorCalls,
                } as FetchDCGridResult)
              : ({
                  status: "nothing",
                  message: nothingMessage,
                } as FetchDCGridResult);
          }),
          catchError((err) => {
            console.log("Внутренняя ошибка", err);
            return of({
              status: "failure",
              message: fetchErrorMessage,
            } as FetchDCGridResult);
          })
        );
      }),
      catchError((err) => {
        const error = parseSupd2ErrorResponse(err);
        this.luMessageService.danger(error.message);
        return of({
          status: "failure",
          message: fetchErrorMessage,
        } as FetchDCGridResult);
      })
    );
  }

  fetchProblemDoctorCalls(
    dateFrom: string,
    dateTo: string
  ): Observable<FetchDCGridResult> {
    const statusKey = ["ON_CORRECTION"];
    return this.fetchDoctorCallsBase({
      needPatients: true,
      needExecutors: false,
      needVisitStatus: false,
      fetchErrorMessage: FETCH_DOCTOR_CALLS_ERROR,
      nothingMessage: FETCH_PROBLEM_DC_NOTHING_MESSAGE,
      searchOptions: { dateFrom, dateTo, statusKey },
    });
  }

  fetchPatientDoctorCalls(
    patientId: number,
    dateFrom: string,
    dateTo: string
  ): Observable<FetchDCGridResult> {
    return this.fetchDoctorCallsBase({
      needPatients: false,
      needExecutors: true,
      needVisitStatus: true,
      fetchErrorMessage: FETCH_DOCTOR_CALLS_ERROR,
      nothingMessage: FETCH_PATIENT_DC_NOTHING_MESSAGE,
      searchOptions: { patientId, dateFrom, dateTo },
    });
  }

  fetchUnidentifiedDoctorCalls(
    dateFrom: string,
    dateTo: string,
    phone?: string,
    address?: string
  ): Observable<FetchDCGridResult> {
    if (!phone && !address) {
      return of({
        status: "nothing",
        message: FETCH_UNIDENTIFIED_EMPTY_SEARCH_MESSAGE,
      } as FetchDCGridResult);
    }
    const incompletePatient = true;
    return this.fetchDoctorCallsBase({
      needPatients: true,
      needExecutors: true,
      needVisitStatus: true,
      fetchErrorMessage: FETCH_DOCTOR_CALLS_ERROR,
      nothingMessage: FETCH_UNIDENTIFIED_NOTHING_MESSAGE,
      searchOptions: { incompletePatient, dateFrom, dateTo, phone, address },
    });
  }

  private loadAllFindCalls(
    searchOptions: FindCallsCcRequestSearchOptionsDto,
    sortingOptions?: Supd2CoreV1SortingOptionsDto
  ): Observable<Supd2CallServiceV1TypesCallCcDto[]> {
    return loadAllPages(
      (pageNumber) =>
        this.supd2Call.findCallsCc({
          body: {
            searchOptions,
            sortingOptions: sortingOptions || {
              sortingParameter: [
                {
                  position: 0,
                  sortingMethod: 1,
                  parameter: "createdDateTime",
                },
              ],
            },
            pagingOptions: {
              pageSize: 30,
              pageNumber,
            },
          },
        }),
      (response) => !response.pagingResults.morePagesAvailable,
      (response) => response.item
    );
  }

  private fetchMfs(mfIds: string[]): Observable<ShortListInfo2Dto[]> {
    if (!mfIds || !mfIds.length) {
      return of([]);
    }
    return this.rmu
      .getMuShortList2({
        body: {
          requesterSystemCode: DEFAULT_REQUESTER_SYSTEM_CODE_FOR_CTO,
          searchQuery: {
            muidgroup: {
              muid: mfIds,
            },
          },
        },
      })
      .pipe(
        map((response) => {
          return (response && response.mulistInfo) || [];
        }),
        catchError((err) => {
          const error = parseRmuErrorResponse(err);
          const UNDEFINED_ERROR = "32";
          if (error instanceof BusinessError) {
            if (error.code === UNDEFINED_ERROR) {
              this.luMessageService.danger(FETCH_MF_ERROR);
            } else if (error.code !== LPUS_NOT_FOUND_ERROR_CODE) {
              this.luMessageService.danger(error.message);
            }
          } else {
            this.luMessageService.danger(FETCH_MF_ERROR);
          }
          return of([]);
        })
      );
  }

  private fetchManyPatients(
    patientIds: number[]
  ): Observable<PersonResponseTypeDto[]> {
    if (!patientIds || !patientIds.length) {
      return of([]);
    }
    const patientIdChunks = DoctorCallsFetchService.chunkPatientArray(
      patientIds,
      99
    );
    const requests = patientIdChunks.map((patientIdChunk) => {
      return this.fetchPatients(patientIdChunk);
    });
    return forkJoin(requests).pipe(
      map((responses) => {
        return responses.reduce((acc, response) => {
          acc = acc.concat(response);
          return acc;
        }, []);
      }),
      catchError((err) => {
        console.log("Внутренняя ошибка", err);
        return of([]);
      })
    );
  }

  private static chunkPatientArray(array: number[], chunk: number) {
    const newArray = [];
    for (let i = 0; i < array.length; i += chunk) {
      newArray.push(array.slice(i, i + chunk));
    }
    return newArray;
  }

  private fetchPatients(
    patientIds: number[]
  ): Observable<PersonResponseTypeDto[]> {
    if (!patientIds || !patientIds.length) {
      return of([]);
    }
    const person = patientIds.map((patientId) => ({
      idEmias: patientId.toString(),
    })); // TODO: +1000000 проверить
    return this.erz
      .getPersonsList({
        body: {
          arg0: {
            person,
          },
        },
      })
      .pipe(
        map((response) => {
          return (
            (response &&
              response.getPersonsListResponse &&
              response.getPersonsListResponse.person) ||
            []
          );
        }),
        catchError((err) => {
          const error = parseErzErrorResponse(err);
          if (error instanceof BusinessError) {
            this.luMessageService.danger(error.message);
          } else {
            this.luMessageService.danger(FETCH_PATIENTS_ERROR);
          }
          return of([]);
        })
      );
  }

  private fetchExecutors(executors: ExecutorsBundle): Observable<Executor[]> {
    if (!executors) {
      return of([]);
    }
    const { availableResourceIds, jobIds, employeeIds } = executors;
    if (!availableResourceIds.length && !jobIds.length && !employeeIds.length) {
      return of([]);
    }

    const requests: Observable<Executor[]>[] = [];
    if (availableResourceIds.length) {
      requests.push(this.fetchArExecutors(availableResourceIds));
    }
    if (jobIds.length) {
      requests.push(
        this.fetchEmployeePacketInfoExecutors({
          jobList: {
            jobID: jobIds.map((jobId) => jobId.toString()),
          },
          executorType: "jobId",
        })
      );
    }
    if (employeeIds.length) {
      requests.push(
        this.fetchEmployeePacketInfoExecutors({
          employeeList: {
            employeeID: employeeIds.map((employeeId) => employeeId.toString()),
          },
          executorType: "employeeId",
        })
      );
    }

    return forkJoin(requests).pipe(
      map((responses) => {
        const [arExecutors] = responses;
        return arExecutors;
      }),
      catchError((err) => {
        console.log("Внутренняя ошибка", err);
        return of([]);
      })
    );
  }

  private fetchArExecutors(
    availableResourceIds: number[]
  ): Observable<Executor[]> {
    return this.resources
      .getAvailableResourceList({
        body: {
          resourceIds: availableResourceIds,
        },
      })
      .pipe(
        map((response) => {
          return (
            response &&
            response.items &&
            response.items.reduce((acc: Executor[], ar) => {
              const { doctors } = ar;
              const mainDoctor =
                doctors && doctors.find((doctor) => doctor.isMain);
              if (mainDoctor) {
                const {
                  firstName,
                  lastName,
                  secondName: middleName,
                } = mainDoctor;
                const name = fullname(
                  { firstName, lastName, middleName },
                  "abbr"
                );
                const executor: Executor = {
                  type: "availableResourceId",
                  id: ar.id,
                  name,
                };
                acc.push(executor);
              }
              return acc;
            }, [])
          );
        }),
        catchError((err) => {
          const error = parseRirErrorResponse(err);
          if (error instanceof BusinessError) {
            this.luMessageService.danger(error.message);
          } else {
            this.luMessageService.danger(FETCH_EXECUTORS_ERROR);
          }
          return of([]);
        })
      );
  }

  private fetchEmployeePacketInfoExecutors(
    params: FetchEmployeePacketParams
  ): Observable<Executor[]> {
    const { jobList, employeeList, executorType } = params;
    return this.rmr
      .getMedicalEmployeePacketInfo2({
        body: {
          requesterSystemCode: DEFAULT_REQUESTER_SYSTEM_CODE_FOR_CTO,
          employeeList,
          jobList,
        },
      })
      .pipe(
        map((response) => {
          return (
            response &&
            response.employeeList &&
            response.employeeList.map((employee) => {
              const { employeeID, info } = employee;
              const id = +employeeID;
              const { name: firstName, secondName: middleName, lastName } =
                info && info.fio;
              const name = fullname(
                { firstName, lastName, middleName },
                "abbr"
              );
              return {
                type: executorType,
                id,
                name,
              } as Executor;
            })
          );
        }),
        catchError((err) => {
          // const error = parseRmrError(err); // TODO: rmr errors
          this.luMessageService.danger(FETCH_EXECUTORS_ERROR);
          return of([]);
        })
      );
  }

  private static parseExecutorIds(
    calls: Supd2CallServiceV1TypesCallCcDto[]
  ): ExecutorsBundle {
    const availableResourceIds = new Set<number>();
    const jobIds = new Set<number>();
    const employeeIds = new Set<number>();
    calls &&
      calls.length &&
      calls.forEach((call) => {
        const availableResourceId =
          call.assignment && call.assignment.availableResourceId;
        const jobId = call.assignment && call.assignment.jobId;
        const employeeId = call.assignment && call.assignment.employeeId;

        if (availableResourceId) {
          availableResourceIds.add(availableResourceId);
        } else if (jobId) {
          jobIds.add(jobId);
        } else if (employeeId) {
          employeeIds.add(employeeId);
        }
      });
    return {
      availableResourceIds: Array.from(availableResourceIds),
      jobIds: Array.from(jobIds),
      employeeIds: Array.from(employeeIds),
    } as ExecutorsBundle;
  }

  private static parseAreaMfIds(
    calls: Supd2CallServiceV1TypesCallCcDto[]
  ): number[] {
    if (!calls || !calls.length) {
      return [];
    }
    const areaMfIds = new Set<number>();
    calls
      .filter((call) => Boolean(call.areaId))
      .forEach((call) => {
        let { receivingMoId, receivingMoBranchId } = call;
        receivingMoId = +receivingMoId;
        receivingMoBranchId = +receivingMoBranchId;
        // @ts-ignore
        if (receivingMoId) {
          areaMfIds.add(+receivingMoId);
        }
        // @ts-ignore
        if (receivingMoBranchId) {
          areaMfIds.add(+receivingMoBranchId);
        }
      });
    return Array.from(areaMfIds);
  }

  private static parsePatientIds(
    calls: Supd2CallServiceV1TypesCallCcDto[]
  ): number[] {
    if (!calls || !calls.length) {
      return [];
    }
    const patientIds = new Set<number>();
    calls
      .filter((call) => Boolean(call.patientId))
      .forEach((call) => {
        const { patientId } = call;
        if (patientId) {
          patientIds.add(patientId);
        }
      });
    return Array.from(patientIds);
  }

  private static parseMfIds(
    calls: Supd2CallServiceV1TypesCallCcDto[]
  ): string[] {
    if (!calls || !calls.length) {
      return [];
    }
    const mfIds = new Set<string>();
    calls.forEach((call) => {
      let {
        receivingMoId: receivingMoIdObj,
        receivingMoBranchId: receivingMoBranchIdObj,
      } = call;
      const receivingMoId: string =
        receivingMoIdObj && receivingMoIdObj.toString();
      const receivingMoBranchId: string =
        receivingMoBranchIdObj && receivingMoBranchIdObj.toString();
      if (receivingMoId && receivingMoId.toLowerCase() !== "null") {
        mfIds.add(receivingMoId);
      }
      if (receivingMoBranchId && receivingMoBranchId.toLowerCase() !== "null") {
        mfIds.add(receivingMoBranchId);
      }
    });
    return Array.from(mfIds);
  }

  private static parseFindCalls(
    params: ParseFindCallsParams
  ): DoctorCallGridRow[] {
    const {
      calls,
      mfs,
      needPatients,
      needExecutors,
      needVisitStatus,
      patients,
      executors,
    } = params;
    if (!calls || !calls.length) {
      return [];
    }
    return calls.map((call) => {
      const { callId, plannedDate, createdDateTime, author } = call;
      const moName = DoctorCallsFetchService.parseMoName(call, mfs);
      const address = DoctorCallsFetchService.parseAddress(call);
      const created = parseISO(createdDateTime);
      const visitDate = plannedDate && parseISO(plannedDate);
      const row: DoctorCallGridRow = {
        callId,
        registration: {
          created,
          author,
        },
        visit: {
          date: visitDate,
        },
        address,
        mo: {
          moName,
        },
      };

      if (needVisitStatus) {
        row.visit.status = DoctorCallsFetchService.parseVisitStatus(call);
      }
      if (needExecutors) {
        row.executor = DoctorCallsFetchService.parseExecutor(call, executors);
      }
      if (needPatients) {
        row.patient = DoctorCallsFetchService.parsePatientInfo(call, patients);
      }

      const color = DoctorCallsFetchService.parseColor(call);
      if (color) {
        row.color = color;
      }

      return row;
    });
  }

  private static parseColor(call: Supd2CallServiceV1TypesCallCcDto): string {
    const { status, createdDateTime } = call;
    const statusKey = status && status.key;
    if (statusKey && OPENED_CALLS_LIST.includes(statusKey) && createdDateTime) {
      const createdDate = parseISO(createdDateTime);
      const daysAgo = differenceInCalendarDays(new Date(), createdDate);
      if (daysAgo >= 7) {
        return "red";
      }
    }
    return null;
  }

  private static parseVisitStatus(
    call: Supd2CallServiceV1TypesCallCcDto
  ): VisitStatus {
    const { status } = call;
    const key: VisitStatusKey = (status && status.key) || "-";
    const name = (status && status.name) || "-";
    let tooltip: string;
    if (key === "CANCELLED") {
      const { cancelReason, cancelDateTime, cancelReasonComment } = call;
      tooltip = DoctorCallsFetchService.parseTooltipText(
        cancelDateTime,
        cancelReason && cancelReason.name,
        cancelReasonComment
      );
    }
    if (key === "REJECTED") {
      const {
        rejectionDateTime,
        rejectionReason,
        rejectionReasonComment,
      } = call;
      tooltip = DoctorCallsFetchService.parseTooltipText(
        rejectionDateTime,
        rejectionReason && rejectionReason.name,
        rejectionReasonComment
      );
    }
    return { key, name, tooltip };
  }

  private static parseTooltipText(
    dateTime: string,
    reasonName: string,
    comment: string
  ) {
    const dateText =
      dateTime && format(parseISO(dateTime), "dd.MM.yyyy, HH:mm");
    const reasonText = comment ? comment : reasonName;
    return dateText && reasonName ? `${reasonText}\n${dateText}` : null;
  }

  private static parseMoName(
    call: Supd2CallServiceV1TypesCallCcDto,
    mfs: ShortListInfo2Dto[]
  ): string {
    let { receivingMoId, receivingMoBranchId } = call;
    receivingMoId = receivingMoId && receivingMoId.toString();
    receivingMoBranchId = receivingMoBranchId && receivingMoBranchId.toString();
    let moName = "-";
    if (receivingMoBranchId) {
      // @ts-ignore
      moName = this.findMfName(receivingMoBranchId, mfs);
    } else if (receivingMoId) {
      // @ts-ignore
      moName = this.findMfName(receivingMoId, mfs);
    }
    return moName;
  }

  private static findMfName(
    receivingMfId: string,
    mfs: ShortListInfo2Dto[]
  ): string {
    const warningMessage = `Идентификатор организации ${receivingMfId}`;
    if (!mfs || !mfs.length) {
      return warningMessage;
    }
    const mf = mfs.find((mf) => mf.muid === receivingMfId);
    return mf ? mf.mushortname : warningMessage;
  }

  private static parsePatientInfo(
    call: Supd2CallServiceV1TypesCallCcDto,
    patients: PersonResponseTypeDto[]
  ): PatientField {
    const { patientId, incompletePatient } = call;
    const patient =
      patientId &&
      patients &&
      patients.find((patient) => patient.idEmias === patientId.toString());
    if (incompletePatient) {
      const {
        emiasId: id,
        birthday,
        gender,
        firstName,
        lastName,
        secondName: middleName,
      } = incompletePatient;
      const name = fullname({ firstName, middleName, lastName }, "full");
      const info = DoctorCallsFetchService.createPersonInfo(gender, birthday);
      return { id, name, info };
    } else if (patient) {
      const {
        name: firstName,
        family: lastName,
        patronymic: middleName,
        dateBirth,
        gender,
      } = patient;
      const info = DoctorCallsFetchService.createPersonInfo(gender, dateBirth);
      const name = fullname({ firstName, middleName, lastName }, "full");
      return { id: patientId, name, info };
    } else if (patientId) {
      return { id: patientId, name: `Пациент ${patientId}`, info: "" };
    } else {
      return { id: null, name: "Пациент не указан", info: "" };
    }
  }

  private static createPersonInfo(
    genderDirty: string,
    dateBirth: string
  ): string {
    const gender =
      genderDirty === "MALE"
        ? "М"
        : genderDirty === "FEMALE"
        ? "Ж"
        : genderDirty;
    const ageText = DoctorCallsFetchService.createAgeInfo(dateBirth);
    const data: string[] = [];
    if (gender) {
      data.push(gender);
    }
    if (ageText) {
      data.push(ageText);
    }
    return data.join(", ");
  }

  private static createAgeInfo(dateBirth: string): string {
    const dateBirthDate = dateBirth && parseISO(dateBirth);
    if (!dateBirthDate) {
      return null;
    }
    const age = Age.createFromDate(dateBirthDate).toString();
    const birthText = format(dateBirthDate, "d MMMM yyyy", { locale: ru });
    return `${age} (${birthText})`;
  }

  private static parseExecutor(
    call: Supd2CallServiceV1TypesCallCcDto,
    executors: Executor[]
  ): string {
    const { assignment } = call;
    const warningMessage = "Не назначен";
    if (!assignment) {
      return warningMessage;
    }
    const { availableResourceId, jobId, employeeId } = call.assignment;
    if (!availableResourceId && !jobId && !employeeId) {
      return warningMessage;
    }
    let executorId: number;
    let executorType: ExecutorType;

    if (availableResourceId) {
      executorId = availableResourceId;
      executorType = "availableResourceId";
    } else if (jobId) {
      executorId = jobId;
      executorType = "jobId";
    } else if (employeeId) {
      executorId = employeeId;
      executorType = "employeeId";
    }

    const warningMessageId = `Назначен (${executorId})`;
    if (!executors || !executors.length) {
      return warningMessageId;
    }
    const executor = executors.find(
      (executor) => executor.type === executorType && executor.id === executorId
    );
    if (!executor) {
      return warningMessageId;
    }
    return executor.name;
  }

  private static parseAddress(call: Supd2CallServiceV1TypesCallCcDto): string {
    if (!call) {
      return "";
    }
    const addressString =
      call.address &&
      call.address.addressCustomType &&
      call.address.addressCustomType.addressString;
    const flat =
      call.address &&
      call.address.addressCustomType &&
      call.address.addressCustomType.flat;
    const flatType = (flat && flat.type && flat.type.short) || "кв.";
    const flatTypeFix = flatType === "кв" ? "кв." : flatType;
    const flatNumber = flat && flat.name;
    return addressString && flatTypeFix && flatNumber
      ? `${addressString}, ${flatTypeFix} ${flatNumber}`
      : addressString;
  }
}
